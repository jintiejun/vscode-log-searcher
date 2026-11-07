# Advanced Log Searcher

A high-performance, multi-line advanced log search extension designed for developers, SREs, and engineers who need to inspect large-scale log directories. It enables lightning-fast, stream-based recursive searching across large workspace log directories without memory overhead (OOM prevention).

---

## Features

* **Workspace Global Search**: Recursively scan and search through massive log and dump directories across your entire workspace.
* **File Name Filtering**: Filter target files using glob patterns (e.g., `*.log`, `*dump*`) to eliminate noise.
* **Multi-line Boolean Logic**: Dynamically add multiple search conditions with flexible `AND`, `OR`, and `NOT` logical operators.
* **Flexible Match Modes**: 
  * **Contain**: Standard substring matching.
  * **EXACT**: Whole word / exact matching.
  * **REGEX**: Powerful regular expression support.
* **Case Sensitivity Control**: Toggle **Match Case** globally to match exact system alerts or error codes (e.g., `CRITICAL`, `ERROR`).
* **Zero-OOM Streaming Engine**: Powered by Node.js streams (`fs.createReadStream` and `readline`), ensuring safe handling of hundreds of megabytes or gigabytes of log data.
* **Dual-Direction Jump**: Click any search result to instantly open the corresponding file and highlight the exact line.

---

## Usage

1. Open a folder or workspace containing your log files or dumps in VS Code.
2. Locate the **Log Search Panel** at the bottom of the Explorer sidebar.
3. (Optional) Enter a file name pattern in the **Files** input box (default is `*`).
4. Build your search query using multiple condition rows, operators (`Contain`, `Exact`, `Regex`), and logical links (`AND`, `OR`, `NOT`).
5. Press **Enter** or click **Search Workspace** to run the query instantly.
6. Click on any result item to jump directly to the target file and line.

---

## Requirements

* VS Code `^1.80.0` or higher.