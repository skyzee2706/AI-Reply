// --- content.js ---
// CONTEXT FINDING + AI LOGIC + REAL-TIME SECURITY CHECK

const FIREBASE_PROJECT_ID = "ai-reply-skyzee";

let lastUrl = location.href; 
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
  }
  checkForReplyBox();
}).observe(document, { subtree: true, childList: true });

function checkForReplyBox() {
  const toolbar = document.querySelector('[data-testid="toolBar"]');
  
  if (toolbar && !toolbar.querySelector('.ai-reply-container')) {
    const container = document.createElement('div');
    container.className = 'ai-reply-container';
    container.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; margin-right: 8px; margin-bottom: 8px; max-width: 220px; justify-content: flex-end;';

    const createBtn = (text, tone, color) => {
      const btn = document.createElement('button');
      btn.innerText = text;
      btn.style.cssText = `background: ${color}; color: white; border: none; padding: 3px 8px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 10px; transition: opacity 0.2s; white-space: nowrap;`;
      
      btn.onmouseover = () => btn.style.opacity = '0.8';
      btn.onmouseout = () => btn.style.opacity = '1';
      btn.onmousedown = (e) => e.preventDefault(); 
      
      btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation(); 
        
        const originalText = btn.innerText;
        btn.innerText = '🔒 Verifying...';
        btn.disabled = true;

        try {
          // --- STEP 1: SECURITY CHECK ---
          const isValid = await checkSubscriptionValidity();
          
          if (!isValid) {
            // If invalid, stop everything immediately
            btn.innerText = '⛔ Locked';
            return; 
          }

          // --- STEP 2: GENERATE REPLY ---
          btn.innerText = '🤖 Thinking...';
          const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
          if (editor) editor.focus();

          await generateAndInsertReply(tone, editor);
          
        } catch (err) {
          alert('Error: ' + err.message);
        } finally {
          // Only restore button if it wasn't locked by security check
          if (btn.innerText !== '⛔ Locked') {
            btn.innerText = originalText;
            btn.disabled = false;
          }
        }
      };
      return btn;
    };

    container.appendChild(createBtn('💬 General', 'general', '#64748b')); 
    container.appendChild(createBtn('👍 Agree', 'agree', '#10b981')); 
    container.appendChild(createBtn('❓ Ask', 'question', '#3b82f6')); 
    container.appendChild(createBtn('🤣 Funny', 'funny', '#f59e0b')); 
    container.appendChild(createBtn('🤔 Debate', 'debate', '#6366f1')); 

    toolbar.appendChild(container);
  }
}

// --- SECURITY LOGIC (CRITICAL) ---
async function checkSubscriptionValidity() {
  // 1. Get Local Data
  const storage = await chrome.storage.sync.get(['expiryTimestamp', 'billingCode']);
  const code = storage.billingCode;
  const expiry = storage.expiryTimestamp;
  const now = Date.now();

  // 2. CHECK EXPIRY (Time-based)
  if (!expiry || now > expiry) {
    alert("⏳ Subscription Expired!\n\nYour access period has ended. Please buy a new code to continue.");
    await chrome.storage.sync.remove(['isBillingVerified', 'expiryTimestamp', 'billingCode']); // Logout user
    return false;
  }

  // 3. CHECK DATABASE EXISTENCE (Anti-Delete/Anti-Ban)
  // We query Firestore to ensure the code actually exists in the DB.
  // If the admin deleted the code, this query will return empty, and we block access.
  if (!code) {
    alert("🔒 No License Found.\nPlease open extension settings to activate.");
    return false;
  }

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "billing_codes" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "code" },
              op: "EQUAL",
              value: { stringValue: code }
            }
          },
          limit: 1
        }
      })
    });

    const data = await response.json();
    
    // If no document found (data is empty array or no document field)
    if (!data || !data[0] || !data[0].document) {
      alert("🚫 License Revoked!\n\nYour billing code is no longer valid or has been deleted from our server.");
      await chrome.storage.sync.remove(['isBillingVerified', 'expiryTimestamp', 'billingCode']); // Force Logout
      return false;
    }

    return true; // All checks passed

  } catch (err) {
    console.error("Verification failed:", err);
    // Optional: Allow offline grace period or block. 
    // Here we strictly block if we can't verify (High Security).
    alert("⚠️ Connection Error\nCannot verify license with server. Please check your internet.");
    return false;
  }
}


// --- DOM & API UTILS (Same as before) ---

function extractTweetTextFromContainer(container) {
  const TWEET_TEXT_SELECTORS = [
    'div[data-testid="tweetText"]',
    'div[lang]',
    '[data-testid="tweetText"] span',
    'div[lang] span'
  ];

  for (const selector of TWEET_TEXT_SELECTORS) {
    const elements = container.querySelectorAll(selector);
    for (const el of elements) {
      const text = el.innerText.trim();
      if (text && text.length > 5) return text;
    }
  }
  return "";
}

function getTweetTextFromDOM(replyBox) {
  let tweetText = "";

  if (!replyBox) return "";
  const article = replyBox.closest("article");
  if (article) {
    tweetText = extractTweetTextFromContainer(article);
  }
  if (!tweetText) {
    const dialog = replyBox.closest('[role="dialog"]');
    if (dialog) {
      tweetText = extractTweetTextFromContainer(dialog);
    }
  }
  if (!tweetText) {
    let parent = replyBox.parentElement;
    while (parent && parent !== document.body) {
      tweetText = extractTweetTextFromContainer(parent);
      if (tweetText) break;
      parent = parent.parentElement;
    }
  }
  if (!tweetText) {
    const nearbyElements = document.querySelectorAll('div[data-testid="tweetText"], article[data-testid="tweet"]');
    for (const el of nearbyElements) {
      const text = extractTweetTextFromContainer(el) || el.innerText.trim();
      if (text && text.length > 5) {
        tweetText = text;
        break;
      }
    }
  }
  return tweetText;
}

async function generateAndInsertReply(tone, editor) {
  const settings = await chrome.storage.sync.get(['provider', 'groqApiKey', 'openaiApiKey', 'geminiApiKey', 'replyPrompt']);
  
  const provider = settings.provider || 'groq';
  let apiKey = '';
  let url = '';
  let isGemini = false;
  let model = '';

  if (provider === 'openai') {
    apiKey = settings.openaiApiKey;
    url = 'https://api.openai.com/v1/chat/completions';
    model = 'gpt-4o-mini';
  } else if (provider === 'gemini') {
    apiKey = settings.geminiApiKey;
    url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
    isGemini = true;
    model = 'gemini-2.0-flash';
  } else {
    apiKey = settings.groqApiKey;
    url = 'https://api.groq.com/openai/v1/chat/completions';
    model = 'llama-3.1-8b-instant';
  }

  if (!apiKey) throw new Error(`API Key for ${provider} is missing. Check extension settings.`);

  const tweetText = getTweetTextFromDOM(editor) || "No context found";
  
  const basePrompt = settings.replyPrompt || "";
  
  let specificInstruction = "";
  if (tone === 'general') specificInstruction = "Reply in a polite, general, and conversational manner.";
  if (tone === 'agree') specificInstruction = "Reply by agreeing enthusiastically with the tweet.";
  if (tone === 'question') specificInstruction = "Reply by asking an insightful follow-up question.";
  if (tone === 'funny') specificInstruction = "Reply with a joke or a witty comment related to the tweet.";
  if (tone === 'debate') specificInstruction = "Reply by politely challenging the view or offering a different perspective.";

  const finalPrompt = `${basePrompt}\n\nTask: ${specificInstruction}\n\ntweet:\n${tweetText}`;

  let generatedText = "";
  
  if (isGemini) {
    const response = await fetch(`${url}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: finalPrompt }] }] })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  } else {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: basePrompt || "You are a helpful assistant." },
          { role: "user", content: finalPrompt }
        ]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    generatedText = data.choices?.[0]?.message?.content;
  }

  if (!generatedText) throw new Error('No text generated.');
  insertText(editor, generatedText);
}

function insertText(editor, text) {
  if (!editor) throw new Error("Reply box not found.");

  editor.focus();
  document.execCommand('selectAll', false, null);

  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer });
    editor.dispatchEvent(pasteEvent);
  } catch (e) {
    document.execCommand('insertText', false, text);
  }
  
  setTimeout(() => {
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
  }, 100);
}