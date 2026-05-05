// Quick diagnostic — prints loan_category coverage in the customers table.
// Run from D:\tools\odpulse\odpulse\server with: node check_categories.mjs
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, "data", "odpulse.sqlite"), { readonly: true });

const total = db.prepare("SELECT COUNT(*) AS n FROM customers").get().n;
const withCategory = db
  .prepare("SELECT COUNT(*) AS n FROM customers WHERE loan_category IS NOT NULL AND loan_category != ''")
  .get().n;
const group = db
  .prepare("SELECT COUNT(*) AS n FROM customers WHERE UPPER(COALESCE(loan_category,'')) LIKE '%GROUP%'")
  .get().n;
const individual = db
  .prepare("SELECT COUNT(*) AS n FROM customers WHERE UPPER(COALESCE(loan_category,'')) LIKE '%INDIVIDUAL%'")
  .get().n;
const distinctValues = db
  .prepare("SELECT DISTINCT loan_category, COUNT(*) AS n FROM customers GROUP BY loan_category ORDER BY n DESC LIMIT 10")
  .all();

console.log({ total, withCategory, group, individual, distinctValues });
db.close();
