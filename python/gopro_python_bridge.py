#!/usr/bin/env python3
"""
GoPro Python Bridge - Uses official Open GoPro SDK for reliable camera control
Communicates with JavaScript app via JSON over stdin/stdout
"""

import asyncio
import json
import sys
import logging
from open_gopro import GoPro

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class GoProBridge:
    def __init__(self):
        self.gopro = None
        self.is_connected = False

    async def connect(self):
        """Connect to GoPro using BLE only"""
        try:
            logger.info("Connecting to GoPro via BLE only...")
            self.gopro = GoPro(enable_wifi=False)  # Disable WiFi, BLE only

            logger.info("Opening GoPro connection...")
            self.gopro.open()  # Not async
            logger.info("GoPro.open() completed")

            # Check if camera is ready
            logger.info("Checking BLE connection status...")
            if not self.gopro.is_ble_connected:
                logger.warning("BLE connection check failed")
                raise Exception("BLE connection failed")

            self.is_connected = True
            logger.info("Successfully connected to GoPro via BLE")
            return {
                "success": True,
                "message": "Connected to GoPro via BLE",
                "connected": True,
                "ble_connected": True,
            }

        except Exception as e:
            logger.error(f"BLE connection failed: {e}")
            self.is_connected = False
            return {"success": False, "error": str(e), "connected": False}

    async def disconnect(self):
        """Disconnect from GoPro"""
        try:
            if self.gopro:
                self.gopro.close()  # Not async
            self.is_connected = False
            logger.info("Disconnected from GoPro")
            return {
                "success": True,
                "message": "Disconnected from GoPro",
                "connected": False,
            }
        except Exception as e:
            logger.error(f"Disconnect error: {e}")
            self.is_connected = False
            return {"success": False, "error": str(e), "connected": False}

    async def get_status(self):
        """Get camera status using BLE commands"""
        try:
            if not self.is_connected or not self.gopro:
                return {"success": False, "error": "Not connected"}

            # Get status using BLE status properties
            busy = self.gopro.ble_status.system_busy
            encoding = self.gopro.ble_status.encoding_active
            ready = self.gopro.ble_status.system_ready

            return {
                "success": True,
                "status": {
                    "busy": str(busy),
                    "encoding": str(encoding),
                    "ready": str(ready),
                    "group": 1,  # Default group
                },
            }
        except Exception as e:
            logger.error(f"BLE status error: {e}")
            return {"success": False, "error": str(e)}

    async def check_connection(self):
        """Check if GoPro is still connected"""
        try:
            if not self.gopro:
                return {
                    "success": True,
                    "connected": False,
                    "ble_connected": False,
                    "message": "No GoPro instance",
                }

            # Check BLE connection status
            ble_connected = self.gopro.is_ble_connected
            self.is_connected = ble_connected

            return {
                "success": True,
                "connected": ble_connected,
                "ble_connected": ble_connected,
                "message": "Connected" if ble_connected else "Disconnected",
            }
        except Exception as e:
            logger.error(f"Connection check error: {e}")
            self.is_connected = False
            return {
                "success": False,
                "error": str(e),
                "connected": False,
                "ble_connected": False,
            }

    async def take_photo(self):
        """Take photo using BLE commands"""
        try:
            if not self.is_connected or not self.gopro:
                return {"success": False, "error": "Not connected"}

            logger.info("Taking photo using BLE commands...")

            # Use BLE command to take photo
            result = self.gopro.ble_command.set_shutter(1)

            # Handle response
            if hasattr(result, "status"):
                status = result.status
            else:
                status = "SUCCESS"  # Assume success if no status field

            if status == "SUCCESS" or str(status) == "ErrorCode.SUCCESS":
                logger.info("Photo taken successfully via BLE!")
                return {"success": True, "message": "Photo taken successfully via BLE"}
            else:
                return {"success": False, "error": f"Photo failed: {status}"}

        except Exception as e:
            logger.error(f"BLE photo error: {e}")
            return {"success": False, "error": str(e)}

    async def handle_command(self, command_data):
        """Handle commands from JavaScript app"""
        command = command_data.get("command")
        command_id = command_data.get("commandId")

        result = None
        if command == "connect":
            result = await self.connect()
        elif command == "disconnect":
            result = await self.disconnect()
        elif command == "status":
            result = await self.get_status()
        elif command == "check_connection":
            result = await self.check_connection()
        elif command == "take_photo":
            result = await self.take_photo()
        else:
            result = {"success": False, "error": f"Unknown command: {command}"}

        # Include commandId in response
        if command_id is not None:
            result["commandId"] = command_id

        return result


async def main():
    """Main loop - read JSON commands from stdin, send responses to stdout"""
    bridge = GoProBridge()

    logger.info("GoPro Python Bridge started - waiting for commands...")

    try:
        while True:
            # Read command from stdin
            line = sys.stdin.readline()
            if not line:
                break

            logger.info(f"Received command: {line.strip()}")

            try:
                command_data = json.loads(line.strip())
                logger.info(f"Parsed command: {command_data}")
                result = await bridge.handle_command(command_data)
                logger.info(f"Command result: {result}")

                # Send response to stdout
                print(json.dumps(result))
                sys.stdout.flush()

            except json.JSONDecodeError as e:
                logger.error(f"JSON decode error: {e}")
                error_result = {"success": False, "error": f"Invalid JSON: {e}"}
                print(json.dumps(error_result))
                sys.stdout.flush()

    except KeyboardInterrupt:
        logger.info("Shutting down...")
        await bridge.disconnect()
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        await bridge.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
