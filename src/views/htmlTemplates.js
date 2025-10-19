/**
 * HTML Templates for LayerSync
 * Contains all HTML templates for the web interface
 */

class HTMLTemplates {
  /**
   * Get the main HTML template
   * @returns {string} HTML template
   */
  static getMainTemplate() {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LayerSync - Professional 3D Printing Timelapse</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            --success-gradient: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
            --warning-gradient: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
            --danger-gradient: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
            --dark-gradient: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
            line-height: 1.6;
        }

        .glass-card {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            transition: all 0.3s ease;
            padding: 2rem;
            margin-bottom: 2rem;
        }

        .glass-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 15px 40px rgba(0, 0, 0, 0.2);
        }

        .status-pill {
            display: inline-flex;
            align-items: center;
            padding: 0.5rem 1rem;
            border-radius: 50px;
            font-size: 0.875rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            gap: 0.5rem;
        }

        .status-pill::before {
            content: '';
            width: 8px;
            height: 8px;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }

        .status-pill.connected {
            background: rgba(34, 197, 94, 0.2);
            color: #16a34a;
            border: 1px solid rgba(34, 197, 94, 0.3);
        }

        .status-pill.connected::before {
            background: #16a34a;
        }

        .status-pill.error {
            background: rgba(239, 68, 68, 0.2);
            color: #dc2626;
            border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .status-pill.error::before {
            background: #dc2626;
        }

        .status-pill.warning {
            background: rgba(245, 158, 11, 0.2);
            color: #d97706;
            border: 1px solid rgba(245, 158, 11, 0.3);
        }

        .status-pill.warning::before {
            background: #d97706;
        }

        .status-pill.idle {
            background: rgba(107, 114, 128, 0.2);
            color: #6b7280;
            border: 1px solid rgba(107, 114, 128, 0.3);
        }

        .status-pill.idle::before {
            background: #6b7280;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .btn-primary, .btn-success, .btn-warning, .btn-danger, .btn-dark {
            border: none;
            color: white;
            font-weight: 600;
            padding: 0.75rem 1.5rem;
            border-radius: 12px;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
            cursor: pointer;
            font-size: 0.875rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }

        .btn-primary {
            background: var(--primary-gradient);
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(102, 126, 234, 0.6);
        }

        .btn-success {
            background: var(--success-gradient);
            box-shadow: 0 4px 15px rgba(79, 172, 254, 0.4);
        }

        .btn-success:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(79, 172, 254, 0.6);
        }

        .btn-warning {
            background: var(--warning-gradient);
            box-shadow: 0 4px 15px rgba(67, 233, 123, 0.4);
        }

        .btn-warning:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(67, 233, 123, 0.6);
        }

        .btn-danger {
            background: var(--danger-gradient);
            box-shadow: 0 4px 15px rgba(250, 112, 154, 0.4);
        }

        .btn-danger:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(250, 112, 154, 0.6);
        }

        .btn-dark {
            background: var(--dark-gradient);
            box-shadow: 0 4px 15px rgba(44, 62, 80, 0.4);
        }

        .btn-dark:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(44, 62, 80, 0.6);
        }

        .btn-primary:active, .btn-success:active, .btn-warning:active, .btn-danger:active, .btn-dark:active {
            transform: translateY(0);
        }

        .btn-primary:disabled, .btn-success:disabled, .btn-warning:disabled, .btn-danger:disabled, .btn-dark:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .section-header {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 1.5rem;
        }

        .section-icon {
            font-size: 1.5rem;
        }

        .section-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: white;
        }

        .device-select {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.1);
            color: white;
            font-size: 0.875rem;
        }

        .device-select option {
            background: #2c3e50;
            color: white;
        }

        .log-box {
            background: rgba(0, 0, 0, 0.3);
            border-radius: 12px;
            padding: 1rem;
            height: 300px;
            overflow-y: auto;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.75rem;
            line-height: 1.4;
            color: #e5e7eb;
        }

        .log-box::-webkit-scrollbar {
            width: 6px;
        }

        .log-box::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 3px;
        }

        .log-box::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.3);
            border-radius: 3px;
        }

        .log-box::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.5);
        }

        .progress-bar {
            width: 100%;
            height: 8px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 4px;
            overflow: hidden;
            margin: 0.5rem 0;
        }

        .progress-fill {
            height: 100%;
            background: var(--success-gradient);
            border-radius: 4px;
            transition: width 0.3s ease;
        }

        .tip-box {
            background: rgba(59, 130, 246, 0.1);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 8px;
            padding: 0.75rem;
            margin-top: 1rem;
            font-size: 0.875rem;
            color: #93c5fd;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
        }

        .w-full {
            width: 100%;
        }

        .text-center {
            text-align: center;
        }

        .text-white {
            color: white;
        }

        .text-gray-300 {
            color: #d1d5db;
        }

        .mb-4 {
            margin-bottom: 1rem;
        }

        .mt-4 {
            margin-top: 1rem;
        }

        @media (max-width: 768px) {
            .glass-card {
                padding: 1.5rem;
                margin-bottom: 1.5rem;
            }

            .grid {
                grid-template-columns: 1fr;
                gap: 1.5rem;
            }
        }
    </style>
</head>
<body>
    <div style="max-width: 1200px; margin: 0 auto; padding: 2rem;">
        <!-- Header -->
        <div class="glass-card text-center">
            <h1 style="font-size: 2.5rem; font-weight: 700; margin-bottom: 0.5rem; background: linear-gradient(135deg, #fff 0%, #e0e7ff 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
                LayerSync
            </h1>
            <p style="color: #cbd5e1; font-size: 1.125rem;">Professional 3D Printing Timelapse Automation</p>
            <p style="color: #94a3b8; font-size: 0.875rem; margin-top: 0.5rem;">v1.0.0 by Emir Kovacevic</p>
        </div>

        <div class="grid">
            <!-- GoPro Connection -->
            <div class="glass-card">
                <div class="section-header">
                    <span class="section-icon">📷</span>
                    <h2 class="section-title">GoPro Camera</h2>
                </div>

                <div id="ble-state" class="status-pill idle mb-4">Disconnected</div>

                <select id="device-select" class="device-select mb-4">
                    <option value="">Select GoPro device...</option>
                </select>

                <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
                    <button id="btn-scan" class="btn-primary">🔍 Scan</button>
                    <button id="btn-connect" class="btn-success">🔗 Connect</button>
                    <button id="btn-reconnect" class="btn-warning">🔄 Reconnect Printer</button>
                    <button id="btn-test-connection" class="btn-primary">✅ Test Connection</button>
                    <button id="btn-request-status" class="btn-dark">📊 Request Full Status</button>
                </div>

                <div class="tip-box">
                    <strong>💡 Tip:</strong> Make sure your GoPro is powered on and in pairing mode. The camera should be discoverable via Bluetooth.
                </div>
            </div>

            <!-- Status Dashboard -->
            <div class="glass-card">
                <div class="section-header">
                    <span class="section-icon">📊</span>
                    <h2 class="section-title">Status Dashboard</h2>
                </div>

                <div style="margin-bottom: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span class="text-gray-300">Printer Status</span>
                        <span id="printer-status" class="text-white">Connecting...</span>
                    </div>
                    <div class="progress-bar">
                        <div id="printer-progress" class="progress-fill" style="width: 0%"></div>
                    </div>
                </div>

                <div style="margin-bottom: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                        <span class="text-gray-300">Print Progress</span>
                        <span id="print-progress-text" class="text-white">0%</span>
                    </div>
                    <div class="progress-bar">
                        <div id="print-progress-bar" class="progress-fill" style="width: 0%"></div>
                    </div>
                </div>

                <div class="tip-box">
                    <strong>📈 Live Data:</strong> Real-time monitoring of printer status and print progress with automatic timelapse triggering.
                </div>
            </div>
        </div>

        <div class="grid">
            <!-- GoPro Camera Card -->
            <div class="glass-card">
                <div class="section-header">
                    <span class="section-icon">🎬</span>
                    <h2 class="section-title">Camera Controls</h2>
                </div>

                <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                    <button id="btn-test-shutter" class="w-full btn-success">📸 Test Shutter</button>
                    <button id="btn-force-control" class="w-full btn-danger">⚡ Force Control</button>
                    <button id="btn-debug" class="w-full btn-dark">🔍 Debug Info</button>
                </div>

                <div class="tip-box">
                    <strong>🎯 Testing:</strong> Use these controls to test camera functionality and troubleshoot connection issues.
                </div>
            </div>

            <!-- Live Activity Log -->
            <div class="glass-card">
                <div class="section-header">
                    <span class="section-icon">📝</span>
                    <h2 class="section-title">Live Activity Log</h2>
                </div>

                <div id="log-box" class="log-box"></div>

                <div class="tip-box">
                    <strong>🔍 Debugging:</strong> Monitor real-time activity and troubleshoot any issues with printer or camera connections.
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="glass-card text-center">
            <p style="color: #94a3b8; font-size: 0.875rem;">
                © 2024 LayerSync by Emir Kovacevic. Made with ❤️ for the 3D printing community.
            </p>
            <div style="margin-top: 1rem;">
                <a href="https://github.com/emirkovacevic/layersync" style="color: #60a5fa; text-decoration: none; margin: 0 1rem;">GitHub</a>
                <a href="https://www.buymeacoffee.com/emirkovace3" style="color: #60a5fa; text-decoration: none; margin: 0 1rem;">Buy Me a Coffee</a>
            </div>
        </div>
    </div>

    <script>
        // JavaScript functionality will be added here
        console.log('LayerSync Web Interface Loaded');
    </script>
</body>
</html>`;
  }
}

module.exports = HTMLTemplates;
