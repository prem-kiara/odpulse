// How many receipts per loan category? Tells us if the category filter
// SHOULD change the receipts count, or whether the data is actually all
// in one category.
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, "data", "odpulse.sqlite"), { readonly: true });

const rows = db.prepare(`
  SELECT
    COALESCE(c.loan_category, '(NULL)') AS loan_category,
    COUNT(DISTINCT col.receipt_no) AS receipts,
    SUM(col.amount) AS amount
  FROM od_collections col
  LEFT JOIN customers c ON c.loan_account_no = col.loan_account_no
  GROUP BY c.loan_category
  ORDER BY receipts DESC
`).all();

console.log(rows);

const total = db.prepare("SELECT COUNT(*) AS n FROM od_collections").get();
console.log("Total receipts in od_collections:", total.n);

db.close();
