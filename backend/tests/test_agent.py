import pytest
from sqlalchemy.orm import Session
from backend.app.database import SessionLocal, engine, Base
from backend.app import models
from backend.app.seed import seed_db, MOCK_PRODUCTS
from backend.app.rag import rag_engine
from backend.app.agent import agent_orchestrator

@pytest.fixture(scope="module")
def db_session():
    # Force SQLite test DB
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # Seed it
        seed_db(db)
        yield db
    finally:
        # Cleanup
        db.query(models.CartItem).delete()
        db.query(models.Cart).delete()
        db.query(models.Product).delete()
        db.commit()
        db.close()

def test_product_seeding(db_session: Session):
    products = db_session.query(models.Product).all()
    assert len(products) == len(MOCK_PRODUCTS)
    assert products[0].name == "Ultralight Carbon Running Shoes"

def test_rag_semantic_search(db_session: Session):
    # Search for "waterproof rolltop bag"
    results = rag_engine.search_products("waterproof rolltop bag", limit=1)
    assert len(results) > 0
    assert "Backpack" in results[0]["name"] or "waterproof" in results[0]["description"].lower()

def test_cart_operations(db_session: Session):
    session_id = "test_user_session_123"
    
    # 1. Add product to cart
    res = agent_orchestrator.add_to_cart(db_session, session_id, product_id=1, quantity=2)
    assert "added 2" in res.lower()
    
    # 2. View cart
    items = agent_orchestrator.view_cart(db_session, session_id)
    assert len(items) == 1
    assert items[0]["product_id"] == 1
    assert items[0]["quantity"] == 2
    
    # 3. Remove product from cart
    res_remove = agent_orchestrator.remove_from_cart(db_session, session_id, product_id=1)
    assert "successfully removed" in res_remove.lower()
    
    # 4. Cart should be empty
    items_empty = agent_orchestrator.view_cart(db_session, session_id)
    assert len(items_empty) == 0

def test_agent_interaction_fallback(db_session: Session):
    session_id = "test_agent_session"
    
    # Send greetings
    res = agent_orchestrator.interact(db_session, session_id, "hello there!")
    assert "hello" in res.reply.lower() or "shopping assistant" in res.reply.lower()
    
    # Search command
    res_search = agent_orchestrator.interact(db_session, session_id, "find me some premium running shoes")
    assert res_search.products is not None
    assert len(res_search.products) > 0
    
    # Check if first one was added to cart via command
    res_add = agent_orchestrator.interact(db_session, session_id, "add the first one to my cart")
    assert "added" in res_add.reply.lower()
    
    # Verify cart is populated
    cart_items = agent_orchestrator.view_cart(db_session, session_id)
    assert len(cart_items) > 0
