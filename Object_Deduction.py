from fastapi import FastAPI
import asyncio
import websockets
import cv2
import base64
import json
from datetime import datetime

app = FastAPI()

# IP Webcam Stream URL (Replace with correct credentials)
IP_CAMERA_URL = "http://10.31.23.88:8081/video"

# Gemini API Configuration
API_KEY = "AIzaSyBiyYtGBqjUKpIdet-CcDUOA1cNl-ZYOrw"  # Replace with your actual Gemini API key
WS_ENDPOINT = (
    f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha."
    f"GenerativeService.BidiGenerateContent?key={API_KEY}"
)

async def get_objects_from_frame(ws, frame_data, frame_label, timeout=10):
    client_message = {
        "clientContent": {
            "turns": [
                {
                    "parts": [
                        {"inlineData": {"mimeType": "image/jpeg", "data": frame_data}}
                    ],
                    "role": "user"
                }
            ],
            "turnComplete": True
        }
    }
    await ws.send(json.dumps(client_message))
    print(f"[{frame_label}] Frame sent, waiting for response...")
    try:
        response = await asyncio.wait_for(ws.recv(), timeout=timeout)
        resp_json = json.loads(response)
        if (
            "serverContent" in resp_json and 
            "modelTurn" in resp_json["serverContent"] and 
            "parts" in resp_json["serverContent"]["modelTurn"]
        ):
            parts = resp_json["serverContent"]["modelTurn"]["parts"]
            full_text = " ".join(part.get("text", "").strip() for part in parts)
            bullets = [line.strip(" *") for line in full_text.split("\n") if line.strip(" *")]
            return bullets
        else:
            print(f"[{frame_label}] Unexpected response format:", response)
            return None
    except Exception as e:
        print(f"[{frame_label}] Error receiving response: {e}")
        return None

@app.get("/detect_objects")
async def detect_objects():
    union_objects = set()
    last_frame_data = None
    frame_index = 1

    async with websockets.connect(WS_ENDPOINT) as ws:
        setup_message = {
            "setup": {
                "model": "models/gemini-2.0-flash-exp",
                "generationConfig": {"responseModalities": ["TEXT"]},
                "systemInstruction": {
                    "parts": [
                        {
                            "text": (
                                "Analyze the image and provide a bullet point list of all objects you see. "
                                "Only output the list. "
                                "Analyze the image and list every object you can identify—even small or partially obscured items. "
                                "Include both prominent and subtle objects in your list."
                            )
                        }
                    ]
                }
            }
        }
        await ws.send(json.dumps(setup_message))
        await ws.recv()

        cap = cv2.VideoCapture(IP_CAMERA_URL)
        if not cap.isOpened():
            return {"error": "Could not open IP Webcam stream"}

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    return {"error": "Failed to capture frame from IP camera"}

                ret, buffer = cv2.imencode('.jpg', frame)
                if not ret:
                    continue
                frame_data = base64.b64encode(buffer).decode('utf-8')
                last_frame_data = frame_data

                bullets = await get_objects_from_frame(ws, frame_data, f"Frame {frame_index}")
                if bullets:
                    union_objects.update(bullets)
                    break
                
                frame_index += 1
                await asyncio.sleep(5)
        finally:
            cap.release()

        additional_requests = 3
        for i in range(1, additional_requests + 1):
            bullets = await get_objects_from_frame(ws, last_frame_data, f"Additional {i}")
            if bullets:
                union_objects.update(bullets)
            frame_index += 1
            await asyncio.sleep(2)

    return {"frame": frame_index, "objects": list(union_objects)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)