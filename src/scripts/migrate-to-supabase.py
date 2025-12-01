#!/usr/bin/env python3
"""
Migrate all data from local PostgreSQL to Supabase
"""

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor
import sys

# Local Database Config
LOCAL_DB = {
    'host': 'localhost',
    'port': 5433,
    'database': 'becometry_db',
    'user': 'becometry',
    'password': 'becometry123'
}

# Supabase Database Config - using connection string with pooler on port 6543
SUPABASE_CONNECTION_STRING = "postgres://postgres.lqptbcfeclexehkfsits:GLfIWQpJqEtcYQHB@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require"

class DatabaseMigrator:
    def __init__(self):
        self.local_conn = None
        self.supabase_conn = None
        self.stats = {
            'tables': 0,
            'rows': 0,
            'errors': []
        }

    def connect(self):
        """Connect to both databases"""
        try:
            print("🔌 Connecting to local database...")
            self.local_conn = psycopg2.connect(**LOCAL_DB)
            print("✅ Connected to local database")

            print("🔌 Connecting to Supabase...")
            self.supabase_conn = psycopg2.connect(SUPABASE_CONNECTION_STRING)
            print("✅ Connected to Supabase")

            return True
        except Exception as e:
            print(f"❌ Connection failed: {e}")
            import traceback
            traceback.print_exc()
            return False

    def get_tables(self):
        """Get list of all tables from local database"""
        try:
            cur = self.local_conn.cursor()
            cur.execute("""
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = 'public'
                ORDER BY tablename
            """)
            tables = [row[0] for row in cur.fetchall()]
            cur.close()
            return tables
        except Exception as e:
            print(f"❌ Error getting tables: {e}")
            return []

    def get_table_schema(self, table_name):
        """Get CREATE TABLE statement for a table"""
        try:
            cur = self.local_conn.cursor()

            # Get table definition
            cur.execute(f"""
                SELECT
                    column_name,
                    data_type,
                    character_maximum_length,
                    column_default,
                    is_nullable
                FROM information_schema.columns
                WHERE table_name = %s
                ORDER BY ordinal_position
            """, (table_name,))

            columns = cur.fetchall()

            # Build CREATE TABLE statement
            create_cols = []
            for col in columns:
                col_name, data_type, max_len, default, nullable = col

                # Build column definition
                col_def = f"{col_name} {data_type.upper()}"

                if max_len:
                    col_def += f"({max_len})"

                if default:
                    # Handle serial/sequence defaults
                    if 'nextval' in str(default):
                        if data_type == 'integer':
                            col_def = f"{col_name} SERIAL"
                        elif data_type == 'bigint':
                            col_def = f"{col_name} BIGSERIAL"
                    else:
                        col_def += f" DEFAULT {default}"

                if nullable == 'NO':
                    col_def += " NOT NULL"

                create_cols.append(col_def)

            # Get primary key
            cur.execute("""
                SELECT a.attname
                FROM pg_index i
                JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                WHERE i.indrelid = %s::regclass AND i.indisprimary
            """, (table_name,))

            pk_cols = [row[0] for row in cur.fetchall()]
            if pk_cols:
                create_cols.append(f"PRIMARY KEY ({', '.join(pk_cols)})")

            create_statement = f"CREATE TABLE IF NOT EXISTS {table_name} (\n  " + ",\n  ".join(create_cols) + "\n)"

            cur.close()
            return create_statement

        except Exception as e:
            print(f"❌ Error getting schema for {table_name}: {e}")
            return None

    def create_table(self, table_name, create_statement):
        """Create table in Supabase"""
        try:
            cur = self.supabase_conn.cursor()

            # Drop table if exists to avoid conflicts
            print(f"   Dropping existing table if exists...")
            cur.execute(f"DROP TABLE IF EXISTS {table_name} CASCADE")

            # Create table
            print(f"   Creating table...")
            cur.execute(create_statement)

            self.supabase_conn.commit()
            cur.close()
            return True

        except Exception as e:
            print(f"❌ Error creating table {table_name}: {e}")
            self.supabase_conn.rollback()
            return False

    def copy_data(self, table_name):
        """Copy all data from local to Supabase"""
        try:
            # Get data from local
            local_cur = self.local_conn.cursor(cursor_factory=RealDictCursor)
            local_cur.execute(f"SELECT * FROM {table_name}")
            rows = local_cur.fetchall()

            if not rows:
                print(f"   ℹ️  No data to copy")
                local_cur.close()
                return 0

            # Get column names
            columns = rows[0].keys()

            # Insert into Supabase
            supabase_cur = self.supabase_conn.cursor()

            insert_query = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
                sql.Identifier(table_name),
                sql.SQL(', ').join(map(sql.Identifier, columns)),
                sql.SQL(', ').join(sql.Placeholder() * len(columns))
            )

            # Insert in batches
            batch_size = 100
            total_rows = len(rows)

            for i in range(0, total_rows, batch_size):
                batch = rows[i:i + batch_size]
                for row in batch:
                    values = [row[col] for col in columns]
                    supabase_cur.execute(insert_query, values)

                self.supabase_conn.commit()
                print(f"   Inserted {min(i + batch_size, total_rows)}/{total_rows} rows")

            local_cur.close()
            supabase_cur.close()

            return total_rows

        except Exception as e:
            print(f"❌ Error copying data for {table_name}: {e}")
            self.supabase_conn.rollback()
            import traceback
            traceback.print_exc()
            return 0

    def migrate_table(self, table_name):
        """Migrate a single table"""
        print(f"\n{'='*70}")
        print(f"📦 Migrating table: {table_name}")
        print(f"{'='*70}")

        # Get schema
        print(f"1️⃣  Getting table schema...")
        create_statement = self.get_table_schema(table_name)
        if not create_statement:
            return False

        # Create table in Supabase
        print(f"2️⃣  Creating table in Supabase...")
        if not self.create_table(table_name, create_statement):
            return False

        # Copy data
        print(f"3️⃣  Copying data...")
        rows_copied = self.copy_data(table_name)

        print(f"✅ Table {table_name} migrated successfully!")
        print(f"   Rows copied: {rows_copied}")

        self.stats['tables'] += 1
        self.stats['rows'] += rows_copied

        return True

    def recreate_foreign_keys(self):
        """Recreate foreign key constraints"""
        print(f"\n{'='*70}")
        print(f"🔗 Recreating foreign key constraints...")
        print(f"{'='*70}")

        try:
            # Get all foreign keys from local
            local_cur = self.local_conn.cursor()
            local_cur.execute("""
                SELECT
                    tc.table_name,
                    kcu.column_name,
                    ccu.table_name AS foreign_table_name,
                    ccu.column_name AS foreign_column_name,
                    tc.constraint_name
                FROM information_schema.table_constraints AS tc
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
            """)

            fks = local_cur.fetchall()

            supabase_cur = self.supabase_conn.cursor()

            for fk in fks:
                table_name, column, ref_table, ref_column, constraint_name = fk

                alter_query = f"""
                    ALTER TABLE {table_name}
                    ADD CONSTRAINT {constraint_name}
                    FOREIGN KEY ({column})
                    REFERENCES {ref_table}({ref_column})
                """

                try:
                    supabase_cur.execute(alter_query)
                    print(f"   ✅ {table_name}.{column} -> {ref_table}.{ref_column}")
                except Exception as e:
                    print(f"   ⚠️  {table_name}.{column} -> {ref_table}.{ref_column}: {str(e)[:100]}")

            self.supabase_conn.commit()
            local_cur.close()
            supabase_cur.close()

        except Exception as e:
            print(f"❌ Error recreating foreign keys: {e}")
            self.supabase_conn.rollback()

    def run(self):
        """Run the full migration"""
        print("="*70)
        print("🚀 Database Migration: Local PostgreSQL → Supabase")
        print("="*70)

        # Connect
        if not self.connect():
            return False

        # Get tables
        tables = self.get_tables()
        print(f"\n📊 Found {len(tables)} tables to migrate:")
        for table in tables:
            print(f"   - {table}")

        # Confirm
        print(f"\n⚠️  WARNING: This will DROP and recreate all tables in Supabase!")
        response = input("Continue? (yes/no): ")
        if response.lower() != 'yes':
            print("❌ Migration cancelled")
            return False

        # Migrate each table (without foreign keys first)
        for table in tables:
            self.migrate_table(table)

        # Recreate foreign keys
        self.recreate_foreign_keys()

        # Print summary
        print(f"\n{'='*70}")
        print(f"✅ MIGRATION COMPLETE!")
        print(f"{'='*70}")
        print(f"Tables migrated: {self.stats['tables']}")
        print(f"Total rows: {self.stats['rows']}")
        print(f"{'='*70}")

        # Close connections
        if self.local_conn:
            self.local_conn.close()
        if self.supabase_conn:
            self.supabase_conn.close()

        return True

def main():
    migrator = DatabaseMigrator()

    try:
        success = migrator.run()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n⚠️  Migration interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
