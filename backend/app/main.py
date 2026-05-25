from fastapi import FastAPI, Depends, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
import os

from backend.app.config import settings
from backend.app.database import get_db, engine, Base
from backend.app import models, schemas
from backend.app.agent import agent_orchestrator
from backend.app.seed import seed_db
from backend.app.auth import hash_password, verify_password, create_access_token, get_current_user, get_current_user_optional

# Create DB Tables on Startup
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Backend AI brain for floating e-commerce assistant."
)

# Set up CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Automatically seed the database on initial start if product table is empty
@app.on_event("startup")
def startup_event():
    print("Application starting up... Seed check initiated.")
    try:
        db = next(get_db())
        seed_db(db)
    except Exception as e:
        print(f"Startup seeding warning: {e}")

@app.get("/")
def read_root():
    return {"message": "GazeAI E-commerce Assistant API is live!", "version": settings.VERSION}


# --- Product Endpoints ---

@app.get("/api/products", response_model=List[schemas.Product])
def list_products(
    category: Optional[str] = Query(None, description="Filter products by category"),
    search: Optional[str] = Query(None, description="Perform semantic product search"),
    db: Session = Depends(get_db)
):
    """List e-commerce products. Supports semantic vector search and category filters."""
    if search:
        # Utilize semantic search engine
        results = agent_orchestrator.search_products(db, query=search, category=category)
        # Convert dictionary list to ORM-like list for Pydantic mapping
        product_ids = [int(p["id"]) for p in results]
        
        # Load from database to preserve standard schemas
        db_products = db.query(models.Product).filter(models.Product.id.in_(product_ids)).all()
        # Sort in the order returned by search results
        db_products.sort(key=lambda x: product_ids.index(x.id) if x.id in product_ids else 99)
        return db_products
        
    query = db.query(models.Product)
    if category:
        query = query.filter(models.Product.category == category)
    return query.all()


@app.get("/api/products/{product_id}", response_model=schemas.Product)
def get_product(product_id: int, db: Session = Depends(get_db)):
    """Retrieve product detail metadata by ID."""
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


# --- Cart Endpoints ---

@app.get("/api/cart/{session_id}", response_model=schemas.Cart)
def get_cart(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """Fetch the active shopping cart. Returns logged-in user's cart if authenticated, else falls back to guest session."""
    if current_user:
        cart = db.query(models.Cart).filter(models.Cart.user_id == current_user.id).first()
        if not cart:
            cart = models.Cart(session_id=f"user_sess_{current_user.id}_{os.urandom(4).hex()}", user_id=current_user.id)
            db.add(cart)
            db.commit()
            db.refresh(cart)
        return cart
        
    cart = db.query(models.Cart).filter(models.Cart.session_id == session_id).first()
    if not cart:
        # Return empty virtual cart schema
        return {"id": 0, "session_id": session_id, "created_at": "2026-05-25T12:00:00", "updated_at": "2026-05-25T12:00:00", "items": []}
    return cart


@app.post("/api/cart/{session_id}", response_model=schemas.Cart)
def add_item_to_cart(
    session_id: str,
    item: schemas.CartItemCreate,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """Add a product item to the cart. Uses authenticated account cart if logged in."""
    target_session_id = session_id
    if current_user:
        cart = db.query(models.Cart).filter(models.Cart.user_id == current_user.id).first()
        if not cart:
            cart = models.Cart(session_id=f"user_sess_{current_user.id}_{os.urandom(4).hex()}", user_id=current_user.id)
            db.add(cart)
            db.commit()
            db.refresh(cart)
        target_session_id = cart.session_id
        
    result = agent_orchestrator.add_to_cart(db, target_session_id, item.product_id, item.quantity)
    if result.startswith("Error"):
        raise HTTPException(status_code=400, detail=result)
        
    cart = db.query(models.Cart).filter(models.Cart.session_id == target_session_id).first()
    return cart


@app.put("/api/cart/{session_id}/items/{product_id}", response_model=schemas.Cart)
def update_cart_item(
    session_id: str,
    product_id: int,
    item_update: schemas.CartItemUpdate,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """Update item quantities in the shopping cart."""
    target_session_id = session_id
    if current_user:
        cart = db.query(models.Cart).filter(models.Cart.user_id == current_user.id).first()
        if cart:
            target_session_id = cart.session_id
            
    cart = db.query(models.Cart).filter(models.Cart.session_id == target_session_id).first()
    if not cart:
        raise HTTPException(status_code=404, detail="Cart not found")
        
    cart_item = db.query(models.CartItem).filter(
        models.CartItem.cart_id == cart.id,
        models.CartItem.product_id == product_id
    ).first()
    
    if not cart_item:
        raise HTTPException(status_code=404, detail="Item not found in cart")
        
    cart_item.quantity = item_update.quantity
    db.commit()
    db.refresh(cart)
    return cart


@app.delete("/api/cart/{session_id}/items/{product_id}", response_model=schemas.Cart)
def delete_cart_item(
    session_id: str,
    product_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """Remove a product item from the active cart session."""
    target_session_id = session_id
    if current_user:
        cart = db.query(models.Cart).filter(models.Cart.user_id == current_user.id).first()
        if cart:
            target_session_id = cart.session_id
            
    result = agent_orchestrator.remove_from_cart(db, target_session_id, product_id)
    if "not found" in result:
         raise HTTPException(status_code=404, detail=result)
         
    cart = db.query(models.Cart).filter(models.Cart.session_id == target_session_id).first()
    return cart


@app.post("/api/cart/merge/{session_id}", response_model=schemas.Cart)
def merge_guest_cart(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Merge items from an anonymous guest cart into the authenticated user's cart."""
    guest_cart = db.query(models.Cart).filter(models.Cart.session_id == session_id).first()
    user_cart = db.query(models.Cart).filter(models.Cart.user_id == current_user.id).first()
    
    if not user_cart:
        user_cart = models.Cart(session_id=f"user_sess_{current_user.id}_{os.urandom(4).hex()}", user_id=current_user.id)
        db.add(user_cart)
        db.commit()
        db.refresh(user_cart)
        
    if guest_cart and guest_cart.items:
        for guest_item in guest_cart.items:
            existing_item = db.query(models.CartItem).filter(
                models.CartItem.cart_id == user_cart.id,
                models.CartItem.product_id == guest_item.product_id
            ).first()
            if existing_item:
                existing_item.quantity += guest_item.quantity
            else:
                new_item = models.CartItem(
                    cart_id=user_cart.id,
                    product_id=guest_item.product_id,
                    quantity=guest_item.quantity
                )
                db.add(new_item)
        
        # Clear guest cart after merge
        db.query(models.CartItem).filter(models.CartItem.cart_id == guest_cart.id).delete()
        db.commit()
        
    db.refresh(user_cart)
    return user_cart


# --- Chat AI Assistant Endpoints ---

# --- Authentication Endpoints ---

@app.post("/api/auth/register", response_model=schemas.TokenResponse)
def register_user(user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    """Create a new user account, setup a default cart, and return a JWT access token."""
    existing_user = db.query(models.User).filter(
        (models.User.username == user_in.username) | 
        (models.User.email == user_in.email)
    ).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username or email already registered.")
    
    hashed_pwd = hash_password(user_in.password)
    db_user = models.User(
        username=user_in.username,
        email=user_in.email,
        hashed_password=hashed_pwd
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    
    # Seed a private shopping cart for the user
    user_cart = models.Cart(
        session_id=f"user_sess_{db_user.id}_{os.urandom(4).hex()}",
        user_id=db_user.id
    )
    db.add(user_cart)
    db.commit()
    
    token = create_access_token(db_user.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": db_user
    }

@app.post("/api/auth/login", response_model=schemas.TokenResponse)
def login_user(login_in: schemas.UserLogin, db: Session = Depends(get_db)):
    """Verify username and password, then return a JWT access token."""
    db_user = db.query(models.User).filter(models.User.username == login_in.username).first()
    if not db_user or not verify_password(login_in.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password.")
        
    token = create_access_token(db_user.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": db_user
    }

@app.get("/api/auth/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(get_current_user)):
    """Retrieve the currently logged-in user profile details."""
    return current_user


# --- Chat AI Assistant Endpoints ---

@app.post("/api/chat", response_model=schemas.ChatResponse)
def chat_with_assistant(
    request: schemas.ChatRequest,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """Send message to AI assistant. Executes LLM agent routing & DB tools."""
    target_session_id = request.session_id
    if current_user:
        session = db.query(models.ChatSession).filter(models.ChatSession.user_id == current_user.id).first()
        if not session:
            session = db.query(models.ChatSession).filter(models.ChatSession.session_id == request.session_id).first()
            if session:
                session.user_id = current_user.id
                db.commit()
            else:
                session = models.ChatSession(session_id=request.session_id, user_id=current_user.id)
                db.add(session)
                db.commit()
        target_session_id = session.session_id
        
    try:
        response = agent_orchestrator.interact(db, target_session_id, request.message)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Assistant error: {str(e)}")


@app.get("/api/chat/{session_id}", response_model=List[schemas.ChatMessage])
def get_chat_history(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """Fetch persistent chat history for the active session or logged-in account."""
    try:
        if current_user:
            session = db.query(models.ChatSession).filter(models.ChatSession.user_id == current_user.id).first()
        else:
            session = db.query(models.ChatSession).filter(models.ChatSession.session_id == session_id).first()
            
        if not session:
            return []
        import json
        history = json.loads(session.history_json)
        return history
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch chat history: {str(e)}")



# --- Seed Trigger Endpoint ---

@app.post("/api/seed", status_code=status.HTTP_201_CREATED)
def trigger_catalog_seeding(db: Session = Depends(get_db)):
    """Seed / Reset e-commerce catalog products in Relational and RAG Vector DBs."""
    try:
        # Clear existing products
        db.query(models.CartItem).delete()
        db.query(models.Cart).delete()
        db.query(models.Product).delete()
        db.commit()
        
        # Run seeder
        seed_db(db)
        return {"status": "success", "message": "Database and vector store re-seeded and re-indexed successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Seeding failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)
