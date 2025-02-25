// server.js
const express = require('express');
const fs = require('fs/promises'); // Promise-based file system access
const Groq = require('groq-sdk');
require('dotenv').config();

// For Node.js 18+, fetch is built-in.
// For older Node.js versions, install and import node-fetch:
// const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

// URL of your FastAPI object detection endpoint
const FASTAPI_ENDPOINT = 'http://localhost:8000/detect_objects';

// Initialize Groq SDK with your API key from the .env file
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Global variable to store the last suggestions from /suggestProjects
let lastSuggestions = null;

/**
 * Sends a request to Groq API for a concise project idea based on the given difficulty.
 * Uses the detected objects and user data (age and learningInterest) in the prompt.
 * Instructs the AI to return a precise JSON array of strings.
 *
 * @param {string} difficulty - "easy", "medium", or "hard"
 * @param {string} objectsList - Comma-separated list of detected objects
 * @param {string} age - The user's age from user_data.json
 * @param {string} learningInterest - The user's learning interest from user_data.json
 * @returns {Promise<Array>} - An array of concise project idea strings
 */
async function getProjectSuggestion(difficulty, objectsList, age, learningInterest) {
  const prompt = `
Using the following detected objects: ${objectsList}.
User's age: ${age} years.
User's learning interest: ${learningInterest}.
Provide a concise ${difficulty}-level project idea that leverages some of these objects.
Return your answer strictly as a JSON array of strings with no additional commentary.
Example:
["Your concise project idea here."]
`;

  const completion = await groq.chat.completions.create({
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    model: 'llama-3.3-70b-versatile',
  });

  const result = completion.choices[0]?.message?.content || '[]';
  try {
    return JSON.parse(result);
  } catch (error) {
    // Fallback: return the raw response wrapped in an array.
    return [result];
  }
}

/**
 * Endpoint: /suggestProjects
 *
 * 1. Fetches detected objects from the FastAPI endpoint.
 * 2. Reads user data (age and learningInterest) from user_data.json.
 * 3. Requests three project suggestions (easy, medium, hard) from Groq.
 * 4. Stores the suggestions in a global variable for later use.
 * 5. Returns the combined suggestions as JSON:
 *    {
 *      "easy": [...],
 *      "medium": [...],
 *      "hard": [...]
 *    }
 */
app.get('/suggestProjects', async (req, res) => {
  try {
    // 1. Get detected objects from the FastAPI endpoint.
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

    // Store the suggestions globally for later detailing.
    lastSuggestions = finalResponse;

    res.json(finalResponse);
  } catch (error) {
    console.error('Error in /suggestProjects:', error);
    res.status(500).json({ error: 'Internal server error', details: error.toString() });
  }
});

/**
 * Endpoint: /detailProject
 *
 * Expects a query parameter "choice" which can be:
 *   - 1 or "easy"
 *   - 2 or "medium"
 *   - 3 or "hard"
 *
 * This endpoint takes the previously suggested concise project idea for the chosen difficulty,
 * then sends it to Groq to obtain a detailed explanation and step-by-step instructions.
 * Returns a JSON response with the detailed explanation:
 *   { "detailed": "Full detailed explanation..." }
 */
app.get('/detailProject', async (req, res) => {
  try {
    const choice = req.query.choice;
    if (!choice) {
      return res.status(400).json({ error: 'Choice parameter is required (1, 2, or 3)' });
    }

    let difficultyKey;
    if (choice === '1' || choice.toLowerCase() === 'easy') {
      difficultyKey = 'easy';
    } else if (choice === '2' || choice.toLowerCase() === 'medium') {
      difficultyKey = 'medium';
    } else if (choice === '3' || choice.toLowerCase() === 'hard') {
      difficultyKey = 'hard';
    } else {
      return res.status(400).json({ error: 'Invalid choice. Use 1/easy, 2/medium, or 3/hard.' });
    }

    if (!lastSuggestions || !lastSuggestions[difficultyKey] || lastSuggestions[difficultyKey].length === 0) {
      return res.status(400).json({ error: 'No suggestion available for the chosen difficulty. Please call /suggestProjects first.' });
    }
    const projectIdea = lastSuggestions[difficultyKey][0]; // select the first suggestion

    // Create a prompt for full detailed explanation
    const prompt = `
Provide a clear and detailed explanation with step-by-step instructions for implementing the following project idea:
"${projectIdea}"
Return only the detailed explanation as plain text.
`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'user', content: prompt }
      ],
      model: 'llama-3.3-70b-versatile',
    });

    const detailedExplanation = completion.choices[0]?.message?.content || '';
    res.json({ detailed: detailedExplanation });
  } catch (error) {
    console.error('Error in /detailProject:', error);
    res.status(500).json({ error: 'Internal server error', details: error.toString() });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
