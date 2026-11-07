import * as vscode from 'vscode';
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  const provider = new LogSearchProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('logSearcherView', provider)
  );
}

class LogSearchProvider implements vscode.WebviewViewProvider {
  private readonly _extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: any,
    _token: vscode.CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this._getHtmlForWebview();

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'search': {
          await this.performWorkspaceSearch(data.rows, data.matchCase, data.filePattern, webviewView.webview);
          break;
        }
        case 'jump': {
          await this.jumpToFileAndLine(data.filePath, data.lineNum);
          break;
        }
      }
    });
  }

  // 工作区多文件全局搜索引擎（支持文件名过滤与防 OOM 流式扫描）
  private async performWorkspaceSearch(
    rows: { logic: 'AND' | 'OR' | 'NOT'; operator: 'CONTAIN' | 'EXACT' | 'REGEX'; keyword: string }[],
    matchCase: boolean,
    filePattern: string,
    webview: vscode.Webview
  ) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showWarningMessage('Please open a folder or workspace first!');
      return;
    }

    const results: { filePath: string; fileName: string; lineNum: number; content: string }[] = [];
    const validRows = rows.filter(r => r.keyword && r.keyword.trim() !== '');

    if (validRows.length === 0) {
      webview.postMessage({ type: 'searchResults', results: [], finished: true });
      return;
    }

    // 预编译正则
    const processedRows = validRows.map(r => {
      let regex: RegExp | null = null;
      if (r.operator === 'REGEX') {
        try {
          regex = new RegExp(r.keyword, matchCase ? '' : 'i');
        } catch (e) {
          regex = null;
        }
      }
      return { ...r, compiledRegex: regex };
    });

    // 递归获取工作区下的所有日志文件并应用文件后缀过滤
    const logFiles: string[] = [];
    for (const folder of workspaceFolders) {
      this.walkDir(folder.uri.fsPath, logFiles, filePattern);
    }

    try {
      for (const filePath of logFiles) {
        if (results.length >= 1000) {break;} // 最多收集1000条防止卡顿

        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });

        let lineNum = 0;
        const fileName = path.basename(filePath);

        for await (const line of rl) {
          lineNum++;
          let lineMatched = false;

          for (let i = 0; i < processedRows.length; i++) {
            const row = processedRows[i];
            const rawKeyword = row.keyword;
            let isHit = false;

            if (row.operator === 'REGEX' && row.compiledRegex) {
              isHit = row.compiledRegex.test(line);
            } else {
              const targetLine = matchCase ? line : line.toLowerCase();
              const targetKw = matchCase ? rawKeyword : rawKeyword.toLowerCase();

              if (row.operator === 'EXACT') {
                const exactRegex = new RegExp(`\\b${escapeRegExp(targetKw)}\\b`, matchCase ? '' : 'i');
                isHit = exactRegex.test(line);
              } else {
                isHit = targetLine.includes(targetKw);
              }
            }

            const rowSatisfied = row.logic === 'NOT' ? !isHit : isHit;

            if (i === 0) {
              lineMatched = rowSatisfied;
            } else {
              if (row.logic === 'OR') {
                lineMatched = lineMatched || rowSatisfied;
              } else {
                lineMatched = lineMatched && rowSatisfied;
              }
            }
          }

          if (lineMatched) {
            results.push({ filePath, fileName, lineNum, content: line });
            if (results.length >= 1000) {break;}
          }
        }
      }

      webview.postMessage({ type: 'searchResults', results, finished: true });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Search error: ${err.message}`);
      webview.postMessage({ type: 'searchResults', results: [], finished: true });
    }
  }

  // 递归遍历文件夹，支持简单的通配符文件名过滤（如 *.log 或 *dump*）
  private walkDir(dir: string, fileList: string[], pattern: string) {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file === '.git' || file === 'node_modules' || file === 'dist') {continue;}
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          this.walkDir(fullPath, fileList, pattern);
        } else {
          // 文件名过滤匹配检查
          if (this.matchFilePattern(file, pattern)) {
            fileList.push(fullPath);
          }
        }
      }
    } catch (e) {
      // 忽略无权限的文件夹
    }
  }

  // 简单的 glob 模式匹配（支持 * 统配符）
  private matchFilePattern(fileName: string, pattern: string): boolean {
    if (!pattern || pattern.trim() === '' || pattern.trim() === '*') {return true;}
    const regexPattern = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
    const regex = new RegExp(regexPattern, 'i');
    return regex.test(fileName);
  }

  private async jumpToFileAndLine(filePath: string, lineNum: number) {
    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

    const targetLine = editor.document.lineAt(lineNum - 1);
    const range = targetLine.range;

    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }

  private _getHtmlForWebview() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: var(--vscode-font-family); padding: 8px; color: var(--vscode-editor-foreground); font-size: 12px; }
            .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-weight: bold; }
            .filter-bar { display: flex; gap: 4px; margin-bottom: 6px; align-items: center; }
            .filter-bar span { font-size: 11px; color: var(--vscode-descriptionForeground); }
            .row-container { display: flex; gap: 4px; margin-bottom: 6px; align-items: center; }
            select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); padding: 3px; font-size: 11px; }
            input[type="text"] { flex: 1; padding: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
            button { padding: 4px 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; }
            button:hover { background: var(--vscode-button-hoverBackground); }
            button:disabled { opacity: 0.6; cursor: not-allowed; }
            .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
            .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
            .btn-danger { background: #a1260d; color: white; }
            .btn-danger:hover { background: #b93217; }
            .action-bar { display: flex; gap: 4px; margin-top: 8px; margin-bottom: 10px; }
            ul { list-style: none; padding: 0; margin: 0; max-height: 280px; overflow-y: auto; }
            li { padding: 4px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; font-family: monospace; font-size: 11px; }
            li:hover { background: var(--vscode-list-hoverBackground); }
            .file-tag { color: var(--vscode-textLink-foreground); font-weight: bold; margin-right: 4px; }
            .line-num { color: var(--vscode-debugTokenExpression-number); font-weight: bold; margin-right: 4px; }
            .checkbox-label { display: flex; align-items: center; gap: 4px; font-weight: normal; font-size: 11px; cursor: pointer; }
        </style>
    </head>
    <body>
        <div class="toolbar">
            <span>TAC Workspace Log Search</span>
            <label class="checkbox-label">
                <input type="checkbox" id="matchCase" /> Match Case
            </label>
        </div>

        <div class="filter-bar">
            <span>Files:</span>
            <input type="text" id="filePattern" value="*" placeholder="e.g. *.log or *dump*" title="Filter files by name or extension" />
        </div>
        
        <div id="filterRows">
            <div class="row-container">
                <select class="row-logic" style="visibility: hidden;">
                    <option value="AND">AND</option>
                </select>
                <select class="row-operator">
                    <option value="CONTAIN">Contain</option>
                    <option value="EXACT">Exact</option>
                    <option value="REGEX">Regex</option>
                </select>
                <input type="text" class="row-keyword" placeholder="Enter keyword or regex..." onkeydown="handleKeyDown(event)" />
                <button onclick="removeRow(this)" class="btn-secondary" disabled>×</button>
            </div>
        </div>

        <div class="action-bar">
            <button onclick="addRow()" class="btn-secondary">+ Add Condition</button>
            <button id="searchBtn" onclick="executeSearch()" style="flex: 1;">Search Workspace</button>
        </div>

        <div style="font-weight: bold; margin-bottom: 4px;" id="resultTitle">Search Results:</div>
        <ul id="resultList"></ul>

        <script>
            const vscode = acquireVsCodeApi();

            function addRow() {
                const container = document.getElementById('filterRows');
                const div = document.createElement('div');
                div.className = 'row-container';
                div.innerHTML = \`
                    <select class="row-logic">
                        <option value="AND">AND</option>
                        <option value="OR">OR</option>
                        <option value="NOT">NOT</option>
                    </select>
                    <select class="row-operator">
                        <option value="CONTAIN">Contain</option>
                        <option value="EXACT">Exact</option>
                        <option value="REGEX">Regex</option>
                    </select>
                    <input type="text" class="row-keyword" placeholder="Enter keyword or regex..." onkeydown="handleKeyDown(event)" />
                    <button onclick="removeRow(this)" class="btn-danger">×</button>
                \`;
                container.appendChild(div);
                // 聚焦新增的输入框
                div.querySelector('.row-keyword').focus();
            }

            function removeRow(btn) {
                btn.parentElement.remove();
            }

            function handleKeyDown(event) {
                if (event.key === 'Enter') {
                    executeSearch();
                }
            }

            function executeSearch() {
                const matchCase = document.getElementById('matchCase').checked;
                const filePattern = document.getElementById('filePattern').value || '*';
                const rowElements = document.querySelectorAll('.row-container');
                const rows = [];

                rowElements.forEach((row, index) => {
                    const logic = index === 0 ? 'AND' : row.querySelector('.row-logic').value;
                    const operator = row.querySelector('.row-operator').value;
                    const keyword = row.querySelector('.row-keyword').value;
                    if (keyword) {
                        rows.push({ logic, operator, keyword });
                    }
                });

                // 状态切换：显示 Searching... 动画状态
                const searchBtn = document.getElementById('searchBtn');
                searchBtn.disabled = true;
                searchBtn.innerText = 'Searching workspace...';
                document.getElementById('resultList').innerHTML = '<li style="color:var(--vscode-descriptionForeground);">Scanning logs across workspace...</li>';

                vscode.postMessage({ type: 'search', rows, matchCase, filePattern });
            }

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.type === 'searchResults') {
                    // 恢复按钮状态
                    const searchBtn = document.getElementById('searchBtn');
                    searchBtn.disabled = false;
                    searchBtn.innerText = 'Search Workspace';

                    const ul = document.getElementById('resultList');
                    ul.innerHTML = '';
                    if (message.results.length === 0) {
                        ul.innerHTML = '<li style="color:var(--vscode-descriptionForeground);">No matching lines found</li>';
                        return;
                    }
                    message.results.forEach(r => {
                        const li = document.createElement('li');
                        li.innerHTML = '<span class="file-tag">' + r.fileName + '</span><span class="line-num">[' + r.lineNum + ']</span>' + escapeHtml(r.content);
                        li.addEventListener('click', () => {
                            vscode.postMessage({ type: 'jump', filePath: r.filePath, lineNum: r.lineNum });
                        });
                        ul.appendChild(li);
                    });
                }
            });

            function escapeHtml(text) {
                return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            }
        </script>
    </body>
    </html>`;
  }
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function deactivate() {}