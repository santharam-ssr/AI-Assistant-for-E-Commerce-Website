import chromadb
from chromadb.config import Settings as ChromaSettings
import os
from typing import List, Dict, Any, Optional
import google.generativeai as genai
from openai import OpenAI
from backend.app.config import settings

class RAGEngine:
    def __init__(self):
        # Create Chroma DB directory
        os.makedirs(settings.CHROMA_PERSIST_DIRECTORY, exist_ok=True)
        
        # Initialize chroma client
        self.chroma_client = chromadb.PersistentClient(
            path=settings.CHROMA_PERSIST_DIRECTORY
        )
        
        # Get or create collection
        self.collection = self.chroma_client.get_or_create_collection(
            name="products",
            metadata={"hnsw:space": "cosine"}
        )
        
        # Initialize API clients
        self.gemini_configured = bool(settings.GEMINI_API_KEY)
        self.openai_configured = bool(settings.OPENAI_API_KEY)
        
        if self.gemini_configured:
            genai.configure(api_key=settings.GEMINI_API_KEY)
        
        self.openai_client = None
        if self.openai_configured:
            self.openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)
            
        print(f"RAG Engine Initialized. Gemini Configured: {self.gemini_configured}, OpenAI Configured: {self.openai_configured}")

    def get_embedding(self, text: str) -> List[float]:
        """Generates embedding using Gemini, OpenAI, or local TF-IDF fallback."""
        if settings.LLM_PROVIDER == "gemini" and self.gemini_configured:
            try:
                response = genai.embed_content(
                    model="models/text-embedding-04",
                    content=text,
                    task_type="retrieval_document"
                )
                return response['embedding']
            except Exception as e:
                print(f"Error generating Gemini embedding: {e}. Falling back to default.")
                
        elif settings.LLM_PROVIDER == "openai" and self.openai_configured:
            try:
                response = self.openai_client.embeddings.create(
                    input=[text],
                    model="text-embedding-3-small"
                )
                return response.data[0].embedding
            except Exception as e:
                print(f"Error generating OpenAI embedding: {e}. Falling back to default.")
        
        # Super-lightweight TF-IDF fallback vector (128-dimensional)
        # Allows local execution without keys.
        return self._generate_fallback_vector(text)

    def _generate_fallback_vector(self, text: str, dimensions: int = 128) -> List[float]:
        """Generates a reproducible pseudo-embedding vector for offline fallback usage."""
        import hashlib
        vector = [0.0] * dimensions
        words = text.lower().split()
        if not words:
            return vector
        for word in words:
            # Map word to a few dimensions using hashes to distribute density
            for i in range(3):
                h = hashlib.md5(f"{word}_{i}".encode('utf-8')).hexdigest()
                idx = int(h, 16) % dimensions
                vector[idx] += 1.0
        # Normalize the vector
        magnitude = sum(x**2 for x in vector) ** 0.5
        if magnitude > 0:
            vector = [x / magnitude for x in vector]
        return vector

    def add_products(self, products: List[Dict[str, Any]]):
        """Index a list of products into ChromaDB."""
        ids = []
        embeddings = []
        documents = []
        metadatas = []
        
        for p in products:
            product_id = str(p["id"])
            text_to_embed = f"Name: {p['name']}. Category: {p['category']}. Description: {p['description']}."
            
            ids.append(product_id)
            embeddings.append(self.get_embedding(text_to_embed))
            documents.append(text_to_embed)
            metadatas.append({
                "id": p["id"],
                "name": p["name"],
                "category": p["category"],
                "price": float(p["price"]),
                "image_url": p.get("image_url") or "",
                "stock": int(p.get("stock", 100))
            })
            
        if ids:
            self.collection.upsert(
                ids=ids,
                embeddings=embeddings,
                documents=documents,
                metadatas=metadatas
            )
            print(f"Successfully indexed {len(ids)} products into RAG vector store.")

    def search_products(self, query: str, limit: int = 5, category: Optional[str] = None) -> List[Dict[str, Any]]:
        """Search products semantically. Supports category filtering."""
        query_embedding = self.get_embedding(query)
        
        where = {}
        if category:
            where["category"] = category
            
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=limit,
            where=where if where else None
        )
        
        products = []
        if results and results["metadatas"] and len(results["metadatas"]) > 0:
            for item in results["metadatas"][0]:
                products.append(item)
        return products

rag_engine = RAGEngine()
