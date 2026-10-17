// Static frontend is already in www/. This script verifies the required entry file.
const fs = require("fs");
if (!fs.existsSync("www/index.html")) {
  console.error("Missing www/index.html");
  process.exit(1);
}
console.log("Expenzo web assets ready in www/");