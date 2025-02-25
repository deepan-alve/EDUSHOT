// server.js
const express = require('express');
const fs = require('fs/promises'); // Use Promises API for reading files
const Groq = require('groq-sdk');
require('dotenv').config();

// For Node.js 18+ the built-in fetch is available. For older versions, install and require node-fetch.
// const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

// URL of your FastAPI object detection endpoint
const FASTAPI_ENDPOINT = 'http://localhost:8000/detect_objects';

// Initialize Groq SDK with your API key
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Sends a request to Groq API for a project suggestion based on the given difficulty.
 * Uses the detected objects and user data (age and learningInterest) in the prompt.
 * The prompt instructs the AI to return a concise JSON array (with no extra commentary).
 *
 * @param {string} difficulty - "easy", "medium", or "hard"
 * @param {string} objectsList - Comma-separated list of detected objects
 * @param {string} age - The user's age from user_data.json
 * @param {string} learningInterest - The user's learning interest from user_data.json
 * @returns {Promise<Array>} - An array of project idea strings
 */
async function getProjectSuggestion(difficulty, objectsList, age, learningInterest) {
  const prompt = `
Using the following detected objects: ${objectsList}.
User's age: ${age} years.
User's learning interest: ${learningInterest}.
Provide a concise and precise ${difficulty}-level project idea that leverages some of these objects.
Return your answer strictly as a JSON array of strings with no additional commentary.
Example output:
["Your project idea text here."]
`;

  const completion = await groq.chat.completions.create({
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    model: 'llama3-70b-8192',
  });

  const result = completion.choices[0]?.message?.content || '[]';

  try {
    return JSON.parse(result);
  } catch (error) {
    // Fallback: return the raw response wrapped in an array.
    return [result];
  }
}

app.get('/suggestProjects', async (req, res) => {
  try {
    // 1. Get detected objects from FastAPI endpoint.
    const fastApiResponse = await fetch(FASTAPI_ENDPOINT);
    const detectedData = await fastApiResponse.json();
    if (!detectedData.objects || detectedData.objects.length === 0) {
      return res.status(400).json({ error: 'No objects detected.' });
    }
    const objectsList = detectedData.objects.join(', ');

    // 2. Read user data from file (simulate a database)
    const userDataRaw = await fs.readFile('./user_data.json', 'utf-8');
    const userData = JSON.parse(userDataRaw);
    const { age, learningInterest } = userData;

    // 3. Get project suggestions for each difficulty.
    const easyProjects = await getProjectSuggestion('easy', objectsList, age, learningInterest);
    const mediumProjects = await getProjectSuggestion('medium', objectsList, age, learningInterest);
    const hardProjects = await getProjectSuggestion('hard', objectsList, age, learningInterest);

    // 4. Combine responses into a single JSON object.
    const finalResponse = {
      easy: easyProjects,
      medium: mediumProjects,
      hard: hardProjects,
    };

    res.json(finalResponse);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.toString() });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
