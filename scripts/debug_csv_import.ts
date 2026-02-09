
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const filePath = path.join(ROOT_DIR, 'stocks.csv');
console.log('Reading:', filePath);

const workbook = XLSX.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(sheet);

if (data.length > 0) {
    console.log('First Row Keys:', Object.keys(data[0]));
    console.log('First Row Data:', data[0]);
} else {
    console.log('No data found');
}
