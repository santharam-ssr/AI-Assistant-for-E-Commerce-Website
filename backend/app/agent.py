import json
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Tuple, Optional
from datetime import datetime
import google.generativeai as genai
from google.generativeai.types import FunctionDeclaration, Tool
from openai import OpenAI
from backend.app.config import settings
from backend.app.database import get_db
from backend.app import models, schemas
from backend.app.rag import rag_engine

# System Prompt defining the AI Assistant behavior
SYSTEM_INSTRUCTION = """You are "GazeAI", a premium AI E-Commerce Assistant.
Your goal is to help customers find products, answer questions, recommend items, and manage their cart.
You have access to a suite of e-commerce tools:
1. `search_products(query)`: Search catalog semantically.
2. `view_cart()`: View the user's current shopping cart.
3. `add_to_cart(product_id, quantity)`: Add a product to the cart.
4. `remove_from_cart(product_id)`: Remove an item from the cart.
5. `recommend_similar(product_id)`: Recommend items similar to the given product.

Guidelines:
- Conversational flow: Keep your responses helpful, polite, and brief.
- Product suggestions: When a user asks for products, always call `search_products` first, then present the results.
- Cart actions: When adding items, make sure you know the specific product ID. If the user says "add the first one" or "add the sneaker", resolve it to the correct product ID from the previous search results, then execute the tool.
- Answer questions using product descriptions returned by the search.
"""

class ECommerceAgent:
    def __init__(self):
        self.gemini_configured = bool(settings.GEMINI_API_KEY)
        self.openai_configured = bool(settings.OPENAI_API_KEY)
        
        if self.gemini_configured:
            genai.configure(api_key=settings.GEMINI_API_KEY)
            
        self.openai_client = None
        if self.openai_configured:
            self.openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)
            
        print(f"AI Agent initialized. Provider: {settings.LLM_PROVIDER}")

    def _get_or_create_chat_session(self, db: Session, session_id: str) -> models.ChatSession:
        """Fetch or create a chat session to maintain persistent history."""
        session = db.query(models.ChatSession).filter(models.ChatSession.session_id == session_id).first()
        if not session:
            session = models.ChatSession(session_id=session_id, history_json="[]")
            db.add(session)
            db.commit()
            db.refresh(session)
        return session

    def _load_history(self, session: models.ChatSession) -> List[Dict[str, Any]]:
        try:
            return json.loads(session.history_json)
        except Exception:
            return []

    def _save_history(self, db: Session, session: models.ChatSession, history: List[Dict[str, Any]]):
        session.history_json = json.dumps(history[-30:])  # Cap history to last 30 messages
        db.commit()

    # --- Core Tool Operations (executed against SQLite/PostgreSQL) ---
    
    def search_products(self, db: Session, query: str, category: Optional[str] = None) -> List[Dict[str, Any]]:
        """Search products using semantic vector search and DB metadata lookup."""
        # 1. Fetch semantic matches from ChromaDB RAG Engine
        raw_results = rag_engine.search_products(query, limit=5, category=category)
        
        # If vector DB returns nothing, search database by product name
        if not raw_results:
            db_products = db.query(models.Product).filter(
                (models.Product.name.like(f"%{query}%")) | 
                (models.Product.category.like(f"%{query}%"))
            ).limit(5).all()
            return [{
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "price": p.price,
                "category": p.category,
                "image_url": p.image_url,
                "stock": p.stock
            } for p in db_products]
            
        return raw_results

    def view_cart(self, db: Session, session_id: str) -> List[Dict[str, Any]]:
        """Return the items in the current session's shopping cart."""
        cart = db.query(models.Cart).filter(models.Cart.session_id == session_id).first()
        if not cart or not cart.items:
            return []
            
        return [{
            "product_id": item.product.id,
            "name": item.product.name,
            "price": item.product.price,
            "quantity": item.quantity,
            "image_url": item.product.image_url,
            "category": item.product.category
        } for item in cart.items]

    def add_to_cart(self, db: Session, session_id: str, product_id: int, quantity: int = 1) -> str:
        """Add a product to the cart. Creates cart if it doesn't exist."""
        # Check product stock and validity
        product = db.query(models.Product).filter(models.Product.id == product_id).first()
        if not product:
            return f"Error: Product ID {product_id} not found."
            
        # Get or create cart
        cart = db.query(models.Cart).filter(models.Cart.session_id == session_id).first()
        if not cart:
            cart = models.Cart(session_id=session_id)
            db.add(cart)
            db.commit()
            db.refresh(cart)
            
        # Check if item exists in cart
        cart_item = db.query(models.CartItem).filter(
            models.CartItem.cart_id == cart.id,
            models.CartItem.product_id == product_id
        ).first()
        
        if cart_item:
            cart_item.quantity += quantity
        else:
            cart_item = models.CartItem(cart_id=cart.id, product_id=product_id, quantity=quantity)
            db.add(cart_item)
            
        db.commit()
        return f"Successfully added {quantity} x '{product.name}' to your cart!"

    def remove_from_cart(self, db: Session, session_id: str, product_id: int) -> str:
        """Remove a product from the shopping cart."""
        cart = db.query(models.Cart).filter(models.Cart.session_id == session_id).first()
        if not cart:
            return "Your cart is already empty."
            
        cart_item = db.query(models.CartItem).filter(
            models.CartItem.cart_id == cart.id,
            models.CartItem.product_id == product_id
        ).first()
        
        if not cart_item:
            return "Item not found in your cart."
            
        product_name = cart_item.product.name
        db.delete(cart_item)
        db.commit()
        return f"Successfully removed '{product_name}' from your cart."

    def recommend_similar(self, db: Session, product_id: int) -> List[Dict[str, Any]]:
        """Recommend products that are similar in category and embedding similarity."""
        target_product = db.query(models.Product).filter(models.Product.id == product_id).first()
        if not target_product:
            return []
            
        # Search semantically using target product description
        query = f"Category: {target_product.category}. Description: {target_product.description}"
        similar = self.search_products(db, query)
        
        # Filter out the target product itself
        return [p for p in similar if p["id"] != product_id]

    # --- Conversational Orchestrator Engine ---

    def interact(self, db: Session, session_id: str, user_message: str) -> schemas.ChatResponse:
        """Main chat API orchestrator. Processes intent, runs tools, returns AI response."""
        chat_session = self._get_or_create_chat_session(db, session_id)
        history = self._load_history(chat_session)
        
        # Add user message to local history
        history.append({"sender": "user", "text": user_message, "timestamp": datetime.utcnow().isoformat()})
        
        # 1. Execute LLM Agent if credentials are set
        if settings.LLM_PROVIDER == "gemini" and self.gemini_configured:
            reply_text, suggested_products = self._run_gemini_agent(db, session_id, user_message, history)
        elif settings.LLM_PROVIDER == "openai" and self.openai_configured:
            reply_text, suggested_products = self._run_openai_agent(db, session_id, user_message, history)
        else:
            # 2. Offline Fallback (extremely smart keyword + rule execution)
            reply_text, suggested_products = self._run_offline_fallback(db, session_id, user_message, history)
            
        # Add bot message to local history
        history.append({
            "sender": "bot",
            "text": reply_text,
            "timestamp": datetime.utcnow().isoformat(),
            "products": suggested_products
        })
        
        # Persist updated history
        self._save_history(db, chat_session, history)
        
        # Map raw dictionary products to Pydantic schemas
        pydantic_products = []
        if suggested_products:
            for p in suggested_products:
                # Ensure we fetch image_url and format correctly
                pydantic_products.append(schemas.Product(
                    id=int(p["id"]),
                    name=p["name"],
                    description=p.get("description") or "",
                    price=float(p["price"]),
                    category=p["category"],
                    image_url=p.get("image_url") or "/placeholder.png",
                    stock=int(p.get("stock", 100)),
                    created_at=datetime.utcnow()
                ))
                
        return schemas.ChatResponse(
            session_id=session_id,
            reply=reply_text,
            products=pydantic_products if pydantic_products else None
        )

    # --- Cloud LLM Agents (Tool Calling Implementations) ---

    def _run_gemini_agent(self, db: Session, session_id: str, message: str, history: List[Dict[str, Any]]) -> Tuple[str, List[Dict[str, Any]]]:
        """Orchestrate Google Gemini Chat Tool loop."""
        try:
            # Setup tools definition
            search_tool = FunctionDeclaration(
                name="search_products",
                description="Search for e-commerce products semantically by query text.",
                parameters={
                    "type": "OBJECT",
                    "properties": {
                        "query": {"type": "STRING", "description": "Natural search term like 'running shoes' or 'premium handbag'"}
                    },
                    "required": ["query"]
                }
            )
            
            view_cart_tool = FunctionDeclaration(
                name="view_cart",
                description="View all products currently in the user's shopping cart."
            )
            
            add_to_cart_tool = FunctionDeclaration(
                name="add_to_cart",
                description="Add an e-commerce product to the user's shopping cart.",
                parameters={
                    "type": "OBJECT",
                    "properties": {
                        "product_id": {"type": "INTEGER", "description": "The numerical ID of the product"},
                        "quantity": {"type": "INTEGER", "description": "The quantity to add (default 1)"}
                    },
                    "required": ["product_id"]
                }
            )
            
            remove_tool = FunctionDeclaration(
                name="remove_from_cart",
                description="Remove a specific product from the user's shopping cart.",
                parameters={
                    "type": "OBJECT",
                    "properties": {
                        "product_id": {"type": "INTEGER", "description": "The numerical ID of the product"}
                    },
                    "required": ["product_id"]
                }
            )
            
            # Group into Gemini Tool suite
            ecommerce_tools = Tool(function_declarations=[search_tool, view_cart_tool, add_to_cart_tool, remove_tool])
            
            # Start Gemini model
            model = genai.GenerativeModel(
                model_name="gemini-1.5-flash",
                tools=[ecommerce_tools],
                system_instruction=SYSTEM_INSTRUCTION
            )
            
            # Format history for Gemini API
            gemini_history = []
            for h in history[:-1]:  # Exclude current message since we send it
                role = "user" if h["sender"] == "user" else "model"
                gemini_history.append({"role": role, "parts": [h["text"]]})
                
            chat = model.start_chat(history=gemini_history)
            response = chat.send_message(message)
            
            # Process tool calls
            suggested_products = []
            if response.function_calls:
                for call in response.function_calls:
                    tool_name = call.name
                    args = call.args
                    
                    print(f"Gemini calling tool: {tool_name} with args: {args}")
                    
                    tool_result = ""
                    if tool_name == "search_products":
                        products_list = self.search_products(db, args.get("query", ""))
                        suggested_products.extend(products_list)
                        tool_result = json.dumps(products_list)
                        
                    elif tool_name == "view_cart":
                        cart_items = self.view_cart(db, session_id)
                        tool_result = json.dumps(cart_items)
                        
                    elif tool_name == "add_to_cart":
                        qty = int(args.get("quantity", 1))
                        tool_result = self.add_to_cart(db, session_id, int(args.get("product_id")), qty)
                        
                    elif tool_name == "remove_from_cart":
                        tool_result = self.remove_from_cart(db, session_id, int(args.get("product_id")))
                        
                    # Feed tool results back to Gemini agent
                    final_response = chat.send_message(
                        genai.types.Part.from_function_response(
                            name=tool_name,
                            response={"result": tool_result}
                        )
                    )
                    return final_response.text, suggested_products
            
            return response.text, suggested_products
        except Exception as e:
            print(f"Gemini Agent execution failed: {e}. Defaulting to offline.")
            return self._run_offline_fallback(db, session_id, message, history)

    def _run_openai_agent(self, db: Session, session_id: str, message: str, history: List[Dict[str, Any]]) -> Tuple[str, List[Dict[str, Any]]]:
        """Orchestrate OpenAI Chat Completion Tool loop."""
        try:
            tools = [
                {
                    "type": "function",
                    "function": {
                        "name": "search_products",
                        "description": "Search products by query",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {"type": "string"}
                            },
                            "required": ["query"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "view_cart",
                        "description": "View shopping cart"
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "add_to_cart",
                        "description": "Add an item to the cart",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "product_id": {"type": "integer"},
                                "quantity": {"type": "integer", "default": 1}
                            },
                            "required": ["product_id"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "remove_from_cart",
                        "description": "Remove an item from the cart",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "product_id": {"type": "integer"}
                            },
                            "required": ["product_id"]
                        }
                    }
                }
            ]
            
            messages = [{"role": "system", "content": SYSTEM_INSTRUCTION}]
            for h in history:
                role = "user" if h["sender"] == "user" else "assistant"
                messages.append({"role": role, "content": h["text"]})
                
            response = self.openai_client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                tools=tools,
                tool_choice="auto"
            )
            
            response_message = response.choices[0].message
            suggested_products = []
            
            if response_message.tool_calls:
                # Add initial model text message if there is one
                messages.append(response_message)
                
                for tool_call in response_message.tool_calls:
                    function_name = tool_call.function.name
                    function_args = json.loads(tool_call.function.arguments)
                    
                    print(f"OpenAI calling tool: {function_name} with args: {function_args}")
                    
                    tool_result = ""
                    if function_name == "search_products":
                        products_list = self.search_products(db, function_args.get("query", ""))
                        suggested_products.extend(products_list)
                        tool_result = json.dumps(products_list)
                    elif function_name == "view_cart":
                        cart_items = self.view_cart(db, session_id)
                        tool_result = json.dumps(cart_items)
                    elif function_name == "add_to_cart":
                        qty = int(function_args.get("quantity", 1))
                        tool_result = self.add_to_cart(db, session_id, int(function_args.get("product_id")), qty)
                    elif function_name == "remove_from_cart":
                        tool_result = self.remove_from_cart(db, session_id, int(function_args.get("product_id")))
                        
                    messages.append({
                        "tool_call_id": tool_call.id,
                        "role": "tool",
                        "name": function_name,
                        "content": tool_result
                    })
                    
                second_response = self.openai_client.chat.completions.create(
                    model="gpt-4o",
                    messages=messages
                )
                return second_response.choices[0].message.content, suggested_products
                
            return response_message.content, suggested_products
        except Exception as e:
            print(f"OpenAI Agent execution failed: {e}. Defaulting to offline.")
            return self._run_offline_fallback(db, session_id, message, history)

    # --- Local Offline Fallback Agent ---

    def _run_offline_fallback(self, db: Session, session_id: str, message: str, history: List[Dict[str, Any]]) -> Tuple[str, List[Dict[str, Any]]]:
        """A premium rule-based offline fallback that mocks intelligent conversation."""
        msg = message.lower()
        suggested_products = []
        
        # 1. Cart Operations (Text triggers)
        if "view cart" in msg or "show my cart" in msg or "what is in my cart" in msg:
            items = self.view_cart(db, session_id)
            if not items:
                return "Your cart is currently empty! Let me know what you'd like to find.", []
            
            cart_text = "\n".join([f"- **{i['name']}** (x{i['quantity']}) - ₹{i['price']}" for i in items])
            total = sum(i["price"] * i["quantity"] for i in items)
            return f"Here are the items in your cart:\n{cart_text}\n\n**Total**: ₹{total:.2f}", []
            
        elif "add to cart" in msg or "add the first" in msg or "add this to cart" in msg:
            # Attempt to extract ID or find the last searched product
            product_id = None
            quantity = 1
            
            # Simple number extraction: e.g. "add product 2"
            import re
            numbers = re.findall(r'\d+', msg)
            if numbers:
                product_id = int(numbers[0])
            else:
                # Fallback to the first item from the user's last catalog search
                last_bot_search = None
                for h in reversed(history[:-1]):
                    if h.get("sender") == "bot" and h.get("products"):
                        last_bot_search = h["products"]
                        break
                if last_bot_search:
                    product_id = int(last_bot_search[0]["id"])
            
            if product_id:
                result = self.add_to_cart(db, session_id, product_id, quantity)
                return f"Sure! {result} Would you like to view your cart or search for anything else?", []
            else:
                return "I couldn't identify which product you wanted to add. Please specify the product name or ID! (e.g. 'Add product 1 to cart')", []
                
        elif "remove" in msg and ("cart" in msg or "item" in msg):
            import re
            numbers = re.findall(r'\d+', msg)
            if numbers:
                product_id = int(numbers[0])
                result = self.remove_from_cart(db, session_id, product_id)
                return result, []
            return "To remove an item, please specify the product ID. For example: 'Remove product 1 from cart'", []

        # 2. Semantic Product Queries
        categories = ["electronics", "shoes", "fashion", "bags", "sports"]
        matched_cat = None
        for cat in categories:
            if cat in msg or (cat[:-1] in msg if cat.endswith("s") else cat in msg):
                matched_cat = cat
                break
                
        # Trigger RAG Search using local TF-IDF matcher
        search_query = message.replace("find", "").replace("search", "").replace("show", "").strip()
        results = self.search_products(db, search_query, category=matched_cat)
        
        if results:
            suggested_products = results
            products_list = "\n".join([f"- **{p['name']}** (₹{p['price']}) - *Category: {p['category']}*" for p in results])
            return f"I found some matches for '{search_query}' that you might love:\n{products_list}\n\nI have attached interactive product cards below. Click **Add to Cart** on any card, or ask me to add it directly!", suggested_products
            
        # 3. Simple conversational chit-chat
        if "hello" in msg or "hi " in msg or "hey" in msg:
            return "Hello! I am GazeAI, your shopping assistant. How can I help you today? You can search for products, ask me about prices, or ask me to manage your cart!", []
            
        elif "thank" in msg:
            return "You are very welcome! Let me know if there's anything else I can do for you.", []
            
        return "I'm not sure I understood completely. You can search products (e.g., 'find blue sneakers'), check your cart ('show my cart'), or add products ('add product 1 to cart'). What would you like to do?", []

agent_orchestrator = ECommerceAgent()
