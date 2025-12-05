const PROVIDER_KEY_FIELDS = {
  groq: { key: "groqApiKey", label: "🔑 Groq API Key", placeholder: "gsk_..." },
  openai: { key: "openaiApiKey", label: "🔑 OpenAI API Key", placeholder: "sk-..." },
  gemini: { key: "geminiApiKey", label: "🔑 Gemini API Key", placeholder: "AIza..." },
};

const FIREBASE_PROJECT_ID = "ai-reply-skyzee";

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const lockScreen = document.getElementById('lockScreen');
  const settingsScreen = document.getElementById('settingsScreen');
  const verifiedBadge = document.getElementById('verifiedBadge');
  const expiryDisplay = document.getElementById('expiryDateDisplay');
  const lockMsg = document.getElementById('lockMsg');
  
  const billingInput = document.getElementById('billingCode');
  const unlockBtn = document.getElementById('unlockBtn');
  const lockStatus = document.getElementById('lockStatus');
  
  const providerSelect = document.getElementById('provider');
  const apiKeyInput = document.getElementById('apiKey');
  const promptInput = document.getElementById('prompt');
  const keyLabel = document.getElementById('keyLabel');
  const saveBtn = document.getElementById('saveBtn');
  const saveStatus = document.getElementById('saveStatus');

  // 1. INITIAL LOAD & SECURITY CHECK
  chrome.storage.sync.get(['expiryTimestamp', 'billingCode', 'provider', 'groqApiKey', 'openaiApiKey', 'geminiApiKey', 'replyPrompt'], async (data) => {
    
    // Immediate Local Check
    const now = Date.now();
    const expiry = data.expiryTimestamp || 0;
    const hasCode = !!data.billingCode;

    if (hasCode && expiry > now) {
      // Looks good locally, but let's do a SILENT REMOTE CHECK
      // to see if the database entry still exists
      showSettingsUI(data, expiry); // Show UI first for responsiveness
      
      const isRemoteValid = await silentRemoteCheck(data.billingCode);
      if (!isRemoteValid) {
        // If remote check fails (DB deleted), force logout immediately
        handleLogout("License revoked or not found in server.");
      }
    } else {
      // Local check failed
      if (expiry > 0 && now > expiry) {
        lockMsg.innerHTML = "❌ Subscription Expired.<br>Please enter a new code to renew.";
        lockMsg.style.color = "#ef4444";
      }
      showLockUI();
    }
  });

  function showLockUI() {
    lockScreen.classList.remove('hidden');
    settingsScreen.classList.add('hidden');
    verifiedBadge.classList.add('hidden');
  }

  function showSettingsUI(data, expiryTimestamp) {
    lockScreen.classList.add('hidden');
    settingsScreen.classList.remove('hidden');
    verifiedBadge.classList.remove('hidden');

    // Format Date
    const dateObj = new Date(expiryTimestamp);
    expiryDisplay.textContent = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); // e.g., 10 Dec 2025

    // Populate Fields
    const currentProvider = data.provider || 'groq';
    providerSelect.value = currentProvider;
    promptInput.value = data.replyPrompt || "";
    updateInputState(currentProvider, data);
  }

  // --- ACTIVATE LICENSE LOGIC ---
  unlockBtn.addEventListener('click', async () => {
    const code = billingInput.value.trim().toUpperCase();
    
    if (code.length < 6) {
      setStatus(lockStatus, "❌ Code must be 6 characters", "red");
      return;
    }

    setStatus(lockStatus, "⏳ Verifying...", "orange");
    unlockBtn.disabled = true;

    try {
      const result = await claimBillingCode(code);
      
      if (result.success) {
        // Save Expiry
        chrome.storage.sync.set({ 
          expiryTimestamp: result.expiryTimestamp,
          billingCode: code 
        }, () => {
          setStatus(lockStatus, "✅ Activated Successfully!", "green");
          billingInput.value = "";
          setTimeout(() => {
            // Reload to show settings
            chrome.storage.sync.get(null, (data) => showSettingsUI(data, result.expiryTimestamp));
          }, 1500);
        });
      } else {
        setStatus(lockStatus, "❌ " + result.error, "red");
        unlockBtn.disabled = false;
      }
    } catch (e) {
      setStatus(lockStatus, "❌ Error: " + e.message, "red");
      unlockBtn.disabled = false;
    }
  });

  // --- STANDARD SETTINGS LOGIC ---
  saveBtn.addEventListener('click', () => {
    const provider = providerSelect.value;
    const currentKeyVal = apiKeyInput.value.trim();
    const promptVal = promptInput.value.trim();

    chrome.storage.sync.get(['groqApiKey', 'openaiApiKey', 'geminiApiKey'], (data) => {
      const payload = {
        provider: provider,
        replyPrompt: promptVal,
        groqApiKey: data.groqApiKey || "",
        openaiApiKey: data.openaiApiKey || "",
        geminiApiKey: data.geminiApiKey || ""
      };
      payload[PROVIDER_KEY_FIELDS[provider].key] = currentKeyVal;

      chrome.storage.sync.set(payload, () => {
        setStatus(saveStatus, '✅ Configuration Saved!', 'green');
        setTimeout(() => setStatus(saveStatus, '', ''), 2000);
      });
    });
  });

  providerSelect.addEventListener('change', () => {
    const newProvider = providerSelect.value;
    chrome.storage.sync.get(['groqApiKey', 'openaiApiKey', 'geminiApiKey'], (data) => {
      updateInputState(newProvider, data);
    });
  });

  function updateInputState(provider, data) {
    const meta = PROVIDER_KEY_FIELDS[provider];
    keyLabel.textContent = meta.label;
    apiKeyInput.placeholder = meta.placeholder;
    apiKeyInput.value = data[meta.key] || "";
  }

  function setStatus(element, text, color) {
    element.textContent = text;
    element.style.color = color === 'red' ? '#ef4444' : (color === 'green' ? '#4ade80' : '#f59e0b');
  }
  
  function handleLogout(reason) {
     chrome.storage.sync.remove(['expiryTimestamp', 'billingCode'], () => {
         showLockUI();
         lockMsg.innerHTML = `⚠️ Access Revoked.<br>${reason}`;
         lockMsg.style.color = "#ef4444";
     });
  }

  // --- REMOTE CHECK HELPERS ---
  
  async function silentRemoteCheck(code) {
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
      // Returns TRUE only if document exists
      return (data && data[0] && data[0].document);
    } catch(e) {
      console.warn("Silent check failed (network error?)", e);
      return true; // Assume valid on network error to prevent annoyance
    }
  }

  // --- CLAIM LOGIC ---
  async function claimBillingCode(code) {
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    
    // 1. Find the code document
    const queryUrl = `${baseUrl}:runQuery`;
    const queryRes = await fetch(queryUrl, {
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
    
    const queryData = await queryRes.json();
    
    if (!queryData || !queryData[0] || !queryData[0].document) {
      return { success: false, error: "Invalid Code" };
    }

    const doc = queryData[0].document;
    const docPath = doc.name; 
    const fields = doc.fields;
    
    // 2. Check if already used
    if (fields.isUsed && fields.isUsed.booleanValue === true) {
      return { success: false, error: "Code already used" };
    }

    // 3. Mark as USED
    const patchUrl = `https://firestore.googleapis.com/v1/${docPath}?updateMask.fieldPaths=isUsed`;
    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          isUsed: { booleanValue: true }
        }
      })
    });

    if (!patchRes.ok) {
        return { success: false, error: "Server Error" };
    }

    // 4. Calculate Expiry
    const durationDays = fields.durationDays ? parseInt(fields.durationDays.integerValue) : 30;
    const expiryTimestamp = Date.now() + (durationDays * 24 * 60 * 60 * 1000);

    return { success: true, expiryTimestamp: expiryTimestamp };
  }
});