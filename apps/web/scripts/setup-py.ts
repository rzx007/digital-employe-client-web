import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Setup Python Server

 */
export function setupPythonServer() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pythonPath = join(__dirname, 'python', 'server.exe')
    console.log('启动Python:', pythonPath)
  
    // 后台运行
    spawn(pythonPath, {
      cwd: dirname(pythonPath),
      stdio: 'ignore'
    })
}