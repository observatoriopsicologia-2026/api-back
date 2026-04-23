from sqlalchemy import create_engine

DATABASE_URL = "mysql+pymysql://u831733382_observatorio:TU_PASSWORD@srv1534.hstgr.io:3306/u831733382_observatorio"

engine = create_engine(DATABASE_URL, connect_args={"connect_timeout": 5})

try:
    conn = engine.connect()
    print("✅ CONEXIÓN OK")
    conn.close()
except Exception as e:
    print("❌ ERROR DE CONEXIÓN:")
    print(e)