import os
import psycopg2
from dotenv import load_dotenv

load_dotenv(r"c:\Users\User\Downloads\skripsiDraft\FaivPredict\ml-service\.env")

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()

# Set owner_id to NULL to quarantine them as legacy rows
cur.execute("""
    UPDATE brands 
    SET owner_id = NULL 
    WHERE id IN ('d2850e10-2788-4833-be1b-cbbb782b68e9', '7c8316af-6692-481d-b6f7-2e5483afa5e1');
""")
conn.commit()
print("Successfully set owner_id to NULL for the legacy brands!")

cur.close()
conn.close()
