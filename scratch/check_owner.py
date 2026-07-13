import os
import psycopg2
from dotenv import load_dotenv

load_dotenv(r"c:\Users\User\Downloads\skripsiDraft\FaivPredict\ml-service\.env")

db_url = os.environ.get("DATABASE_URL")
conn = psycopg2.connect(db_url)
cur = conn.cursor()
cur.execute("SELECT id, name, niche, owner_id FROM brands;")
rows = cur.fetchall()
print("Brands:")
for r in rows:
    print(r)
cur.close()
conn.close()
