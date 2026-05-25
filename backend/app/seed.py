from sqlalchemy.orm import Session
from backend.app.database import SessionLocal, engine, Base
from backend.app import models
from backend.app.rag import rag_engine

MOCK_PRODUCTS = [
    {
        "id": 1,
        "name": "Ultralight Carbon Running Shoes",
        "description": "Aerodynamic athletic sneakers featuring carbon fiber plate technology, hyper-responsive foam cushioning, and ultra-breathable flyknit mesh. Perfect for marathons, sprints, and high-performance track training.",
        "price": 6499.00,
        "category": "shoes",
        "image_url": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&auto=format&fit=crop",
        "stock": 45
    },
    {
        "id": 2,
        "name": "Retro Leather Trainer Sneakers",
        "description": "Handcrafted minimalist low-top sneakers in clean white full-grain leather. Vintage tennis shoe style with ortholite inner sole cushioning and durable cupsole rubber construction.",
        "price": 3899.00,
        "category": "shoes",
        "image_url": "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=500&auto=format&fit=crop",
        "stock": 60
    },
    {
        "id": 3,
        "name": "Classic Italian Leather Loafers",
        "description": "Formal slip-on shoes handmade from rich hand-burnished brown calfskin leather. Double-stitched seams, soft padded leather lining, and stacked leather heel. Ideal for business-casual and formal attire.",
        "price": 7999.00,
        "category": "shoes",
        "image_url": "https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=500&auto=format&fit=crop",
        "stock": 30
    },
    {
        "id": 4,
        "name": "Premium Merino Wool Knit Sweater",
        "description": "Luxuriously soft crewneck sweater knitted from 100% fine Australian merino wool. Superior temperature regulation, naturally odor-resistant, slim-fitting profile in heather grey.",
        "price": 2899.00,
        "category": "fashion",
        "image_url": "https://images.unsplash.com/photo-1614975058789-41316d0e2e9c?w=500&auto=format&fit=crop",
        "stock": 80
    },
    {
        "id": 5,
        "name": "Urban Explorer Stretch Cargo Pants",
        "description": "Rugged, water-resistant cargo trousers with 4-way stretch fabric and utility zipper pockets. Perfect for urban environments and light outdoor hiking. Color: Olive Green.",
        "price": 2199.00,
        "category": "fashion",
        "image_url": "https://images.unsplash.com/photo-1517423568366-8b83523034fd?w=500&auto=format&fit=crop",
        "stock": 55
    },
    {
        "id": 6,
        "name": "Premium Selvedge Denim Jeans",
        "description": "Raw indigo 14.5 oz Japanese selvedge denim jeans. Durable rigid construction that naturally ages and forms custom fades over time. Tailored straight-slim fit.",
        "price": 3499.00,
        "category": "fashion",
        "image_url": "https://images.unsplash.com/photo-1542272604-787c3835535d?w=500&auto=format&fit=crop",
        "stock": 75
    },
    {
        "id": 7,
        "name": "GazeSmart Pro OLED Smartwatch",
        "description": "Premium smartwatch featuring an ultra-bright always-on 1.43-inch AMOLED screen, continuous advanced heart rate sensor, blood oxygen SpO2 monitoring, stress tracker, integrated GPS navigation, and 7-day battery life.",
        "price": 14999.00,
        "category": "electronics",
        "image_url": "https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=500&auto=format&fit=crop",
        "stock": 25
    },
    {
        "id": 8,
        "name": "ANC Wireless Headphones v2",
        "description": "Premium over-ear active noise-cancelling wireless headphones with audiophile custom-tuned 40mm drivers. Features high-res audio playback, spatial audio surround sound, and a whopping 45-hour battery capacity.",
        "price": 8999.00,
        "category": "electronics",
        "image_url": "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&auto=format&fit=crop",
        "stock": 40
    },
    {
        "id": 9,
        "name": "Urban Roll-Top Waterproof Backpack",
        "description": "Ultra-tough waterproof roll-top travel backpack engineered from 1000D Cordura ballistic nylon. Integrates a padded 16-inch laptop pocket, side bottle sleeves, ergonomic breathable mesh shoulder straps, and anti-theft zipper layouts.",
        "price": 4499.00,
        "category": "bags",
        "image_url": "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500&auto=format&fit=crop",
        "stock": 50
    }
]

def seed_db(db: Session = None):
    # Ensure tables exist
    Base.metadata.create_all(bind=engine)
    
    local_session = False
    if db is None:
        db = SessionLocal()
        local_session = True
        
    try:
        # Check if database is already seeded
        existing_count = db.query(models.Product).count()
        if existing_count > 0:
            print("Database already contains product records. Skipping relational seeding.")
        else:
            print("Seeding database tables with premium e-commerce catalog items...")
            for p_dict in MOCK_PRODUCTS:
                prod = models.Product(
                    id=p_dict["id"],
                    name=p_dict["name"],
                    description=p_dict["description"],
                    price=p_dict["price"],
                    category=p_dict["category"],
                    image_url=p_dict["image_url"],
                    stock=p_dict["stock"]
                )
                db.add(prod)
            db.commit()
            print("Database tables seeded successfully!")
            
        # Re-index items into ChromaDB
        print("Re-indexing catalog items into RAG vector engine...")
        all_db_products = db.query(models.Product).all()
        products_to_index = []
        for p in all_db_products:
            products_to_index.append({
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "price": p.price,
                "category": p.category,
                "image_url": p.image_url,
                "stock": p.stock
            })
        rag_engine.add_products(products_to_index)
        print("ChromaDB RAG indexing complete!")
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding database: {e}")
        raise e
    finally:
        if local_session:
            db.close()

if __name__ == "__main__":
    seed_db()
