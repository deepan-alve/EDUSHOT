const WebSocket = require('ws');
const axios = require('axios');
const Jimp = require('jimp');
const fs = require('fs');
const base64 = require('base64-js');
const { v4: uuidv4 } = require('uuid');

const IP_CAMERA_URL = "http://10.31.23.88:8080/video";
const API_KEY = "AIzaSyBiyYtGBqjUKpIdet-CcDUOA1cNl-ZYOrw"; // Replace with your actual Gemini API key
const WS_ENDPOINT = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

async function getBase64FromCamera() {
    try {
        const response = await axios({
            url: IP_CAMERA_URL,
            responseType: 'arraybuffer',
        });
        
        const image = await Jimp.read(response.data);
        return await image.getBase64Async(Jimp.MIME_JPEG);
    } catch (error) {
        console.error("Error capturing frame:", error);
        return null;
    }
}

async function getObjectsFromFrame(ws, frameData, frameLabel, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const clientMessage = {
            clientContent: {
                turns: [
                    {
                        parts: [
                            { inlineData: { mimeType: "image/jpeg", data: frameData.split(",")[1] } }
                        ],
                        role: "user"
                    }
                ],
                turnComplete: true
            }
        };

        ws.send(JSON.stringify(clientMessage));
        console.log(`[${frameLabel}] Frame sent, waiting for response...`);

        const timer = setTimeout(() => {
            reject(`[${frameLabel}] Response timeout`);
        }, timeout);

        ws.once('message', (response) => {
            clearTimeout(timer);
            try {
                const respJson = JSON.parse(response);
                if (respJson.serverContent?.modelTurn?.parts) {
                    const parts = respJson.serverContent.modelTurn.parts;
                    const fullText = parts.map(part => part.text.trim()).join(" ");
                    const bullets = fullText.split("\n").map(line => line.replace(/^\* /, '').trim()).filter(line => line);
                    resolve(bullets);
                } else {
                    console.log(`[${frameLabel}] Unexpected response format:`, response);
                    resolve(null);
                }
            } catch (error) {
                reject(`[${frameLabel}] Error parsing response: ${error}`);
            }
        });
    });
}

async function streamUntilResponse() {
    const unionObjects = new Set();
    let lastFrameData = null;
    let frameIndex = 1;
    
    const ws = new WebSocket(WS_ENDPOINT);
    
    ws.on('open', async () => {
        const setupMessage = {
            setup: {
                model: "models/gemini-2.0-flash-exp",
                generationConfig: { responseModalities: ["TEXT"] },
                systemInstruction: {
                    parts: [{
                        text: "Analyze the image and provide a bullet point list of all objects you see. Only output the list."
                    }]
                }
            }
        };
        ws.send(JSON.stringify(setupMessage));

        ws.once('message', async () => {
            console.log("Setup complete, starting frame capture...");

            while (true) {
                lastFrameData = await getBase64FromCamera();
                if (!lastFrameData) continue;

                const bullets = await getObjectsFromFrame(ws, lastFrameData, `Frame ${frameIndex}`).catch(console.error);
                if (bullets && bullets.length > 0) {
                    console.log(`[Frame ${frameIndex}] Valid response received:`, bullets);
                    bullets.forEach(obj => unionObjects.add(obj));
                    break;
                }

                frameIndex++;
                await new Promise(res => setTimeout(res, 5000));
            }

            for (let i = 1; i <= 3; i++) {
                const bullets = await getObjectsFromFrame(ws, lastFrameData, `Additional ${i}`).catch(console.error);
                if (bullets) bullets.forEach(obj => unionObjects.add(obj));
                await new Promise(res => setTimeout(res, 2000));
            }

            const finalResult = { frame: frameIndex, objects: Array.from(unionObjects) };
            const filename = `detected_objects_${uuidv4()}.json`;
            fs.writeFileSync(filename, JSON.stringify({ timestamp: new Date().toISOString(), result: finalResult }, null, 2));
            console.log("Final union response saved to", filename);
            console.log("Combined list of detected objects:", finalResult.objects);
            ws.close();
        });
    });

    ws.on('error', console.error);
}

streamUntilResponse();
