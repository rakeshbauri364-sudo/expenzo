"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const webDir = path.join(root, "www");
const files = [
  "index.html",
  "app.js",
  "styles.css",
  "option4-stylish-cards.css",
  "config.js",
  "manifest.json"
];

fs.mkdirSync(webDir, { recursive: true });

for (const file of files) {
  const source = path.join(root, file);
  const destination = path.join(webDir, file);

  if (!fs.existsSync(source)) {
    console.error(`Missing required file: ${file}`);
    process.exit(1);
  }

  fs.copyFileSync(source, destination);
}

console.log("Expenzo web files copied successfully to www/");
