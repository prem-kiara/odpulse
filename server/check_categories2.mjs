// How many NULL-category rows have center_name vs not?
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, "data", "odpulse.sqlite"), { readonly: true });

const r = db
  .prepare(
    `SELECT
       CASE WHEN center_name IS NOT NULL AND center_name != '' THEN 'has_center' ELSE 'no_center' END AS k,
       COUNT(*) AS n
     FROM customers
     WHERE loan_category IS NULL OR loan_category = ''
     GROUP BY k`
  )
  .all();

console.log(r);
db.close();
