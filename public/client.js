// Updated client.js with function calling and cart management

// DOM Elements
const connectBtn = document.getElementById('connectBtn');
const pushToTalkToggle = document.getElementById('pushToTalkToggle');
const talkBtn = document.getElementById('talkBtn');
const audioToggle = document.getElementById('audioToggle');
const logsToggle = document.getElementById('logsToggle');
const logs = document.getElementById('logs');
const logEntries = document.getElementById('logEntries');
const transcript = document.getElementById('transcript');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const connectionBadge = document.getElementById('connectionBadge');
const audioStatus = document.getElementById('audioStatus');
const cartItemsElement = document.getElementById('cartItems');
const cartTotalElement = document.getElementById('cartTotal');
const itemCountElement = document.getElementById('itemCount');
const microphoneIndicator = document.getElementById('microphoneIndicator');
const statusElement = document.getElementById('status');

let isAssistantSpeaking = false;
let isCancelling = false;
let responseRequestPending = false;
let isResponding = false;
let responseQueue = [];

// Global variables
let peerConnection = null;
let dataChannel = null;
let audioElement = null;
let sessionStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, CONNECTED
let isPushToTalkActive = false;
let isUserSpeaking = false;
let cart = [];
let totalPrice = 0;
let messageId = 0;
let processingFunction = false; // Tracking if we're currently processing a function call
let customerName, customerPhone, customerAddress; // Customer info for checkout
let startTimeRef = { current: 0 };
let scheduledAudioSources = [];
let audioContext = null;
let microphoneStream = null;
let processor = null;
let isConversationActive = false;
const DEBUG = true; // Enable debug logging

// Add function for debug logging
function debugLog(message, data) {
    if (DEBUG) {
        if (data) {
            console.log(`[CLIENT] ${message}`, data);
        } else {
            console.log(`[CLIENT] ${message}`);
        }
    }
}

// Initialize audio element
function initAudioElement() {
    if (!audioElement) {
        console.log('Creating new audio element');
        audioElement = new Audio();
        audioElement.autoplay = audioToggle.checked;
        
        // Add event listeners for debugging
        audioElement.onplay = () => {
            console.log('Audio playback started');
            updateAudioStatus(true, audioElement.muted);
        };
        
        audioElement.onpause = () => {
            console.log('Audio playback paused');
        };
        
        audioElement.onerror = (e) => {
            console.error('Audio error:', e);
            updateAudioStatus(false);
        };
        
        // Append to DOM to ensure it works properly
        audioElement.style.display = 'none';
        document.body.appendChild(audioElement);
    }
}

// Update audio status
function updateAudioStatus(isConnected = false, isMuted = false) {
    if (isConnected) {
        audioStatus.textContent = 'Audio: Connected' + (isMuted ? ' (Muted)' : '');
    } else if (sessionStatus === 'CONNECTING') {
        audioStatus.textContent = 'Audio: Connecting...';
    } else if (sessionStatus === 'CONNECTED') {
        audioStatus.textContent = 'Audio: Waiting for stream';
    } else {
        audioStatus.textContent = 'Audio: Not initialized';
    }
}

// Toggle functions
pushToTalkToggle.addEventListener('change', function() {
    isPushToTalkActive = this.checked;
    talkBtn.disabled = !this.checked || sessionStatus !== 'CONNECTED';
    
    if (sessionStatus === 'CONNECTED') {
        updateSession();
    }
});

audioToggle.addEventListener('change', function() {
    if (audioElement) {
        console.log('Toggling audio playback:', this.checked);
        audioElement.muted = !this.checked;
        
        // Try to play if we're unmuting
        if (this.checked && audioElement.paused && audioElement.srcObject) {
            console.log('Attempting to play audio');
            audioElement.play().catch(err => {
                console.error('Error playing audio:', err);
            });
        }
        
        // Update audio status
        if (sessionStatus === 'CONNECTED') {
            audioStatus.textContent = 'Audio: Connected' + (this.checked ? '' : ' (Muted)');
        }
    }
});

logsToggle.addEventListener('change', function() {
    logs.classList.toggle('hidden', !this.checked);
});

// Connect/Disconnect
connectBtn.addEventListener('click', function() {
    if (sessionStatus === 'CONNECTED' || sessionStatus === 'CONNECTING') {
        disconnectFromRealtime();
    } else {
        connectToRealtime();
    }
});

// Push to talk
talkBtn.addEventListener('mousedown', handleTalkButtonDown);
talkBtn.addEventListener('mouseup', handleTalkButtonUp);
talkBtn.addEventListener('touchstart', handleTalkButtonDown);
talkBtn.addEventListener('touchend', handleTalkButtonUp);

// Text message
sendMessageBtn.addEventListener('click', sendTextMessage);
messageInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && sessionStatus === 'CONNECTED') {
        sendTextMessage();
    }
});

// Log events
function logEvent(direction, eventName, eventData) {
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    logEntry.dataset.expanded = 'false';
    
    const timestamp = new Date().toLocaleTimeString();
    const arrow = direction === 'client' ? '▲' : '▼';
    const arrowClass = direction === 'client' ? 'client' : 'server';
    
    logEntry.innerHTML = `
        <span class="arrow ${arrowClass}">${arrow}</span>
        <span class="event-name">${eventName}</span>
        <span class="timestamp">${timestamp}</span>
        <div class="log-content">${JSON.stringify(eventData, null, 2)}</div>
    `;
    
    logEntry.addEventListener('click', function() {
        const isExpanded = this.dataset.expanded === 'true';
        this.dataset.expanded = !isExpanded;
        this.classList.toggle('expanded', !isExpanded);
    });
    
    logEntries.appendChild(logEntry);
    logEntries.scrollTop = logEntries.scrollHeight;
}

// Update UI based on session status
function updateUIForSessionStatus() {
    connectBtn.textContent = 
        sessionStatus === 'CONNECTED' ? 'Disconnect' : 
        sessionStatus === 'CONNECTING' ? 'Connecting...' : 'Connect';
    
    connectBtn.classList.toggle('connected', sessionStatus === 'CONNECTED');
    connectBtn.classList.toggle('connecting', sessionStatus === 'CONNECTING');
    
    talkBtn.disabled = !isPushToTalkActive || sessionStatus !== 'CONNECTED';
    sendMessageBtn.disabled = sessionStatus !== 'CONNECTED';
    messageInput.disabled = sessionStatus !== 'CONNECTED';
    
    // Update connection badge
    connectionBadge.textContent = sessionStatus;
    connectionBadge.className = 'badge ' + sessionStatus.toLowerCase();
    
    // Update audio status
    updateAudioStatus(
        sessionStatus === 'CONNECTED' && audioElement && audioElement.srcObject, 
        audioElement && audioElement.muted
    );
}

// Add message to transcript
function addMessage(role, text, isHidden = false) {
    if (isHidden) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}-message`;
    messageDiv.id = `message-${messageId++}`;
    
    const timestamp = document.createElement('div');
    timestamp.className = 'timestamp';
    timestamp.textContent = new Date().toLocaleTimeString();
    
    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = text;
    
    messageDiv.appendChild(timestamp);
    messageDiv.appendChild(content);
    
    transcript.appendChild(messageDiv);
    transcript.scrollTop = transcript.scrollHeight;
    
    return messageDiv.id;
}

// Update message content
function updateMessage(id, text, append = false) {
    const messageDiv = document.getElementById(id);
    if (!messageDiv) return;
    
    const content = messageDiv.querySelector('.content');
    
    if (append) {
        content.textContent += text;
    } else {
        content.textContent = text;
    }
    
    transcript.scrollTop = transcript.scrollHeight;
}

// Add message to transcript (alternative version with consistent naming)
function addMessageToTranscript(message) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('transcript-message');
    messageElement.classList.add(message.speaker + '-message');
    messageElement.textContent = message.text;
    transcript.appendChild(messageElement);
    
    // Scroll to bottom
    transcript.scrollTop = transcript.scrollHeight;
}

// Fetch session token
async function fetchSessionToken() {
    try {
        console.log('Fetching session token...');
        logEvent('client', 'fetch_session_token_request', { url: '/api/session' });
        
        const response = await fetch('/api/session', {
            method: 'POST'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Server returned an error:', errorData);
            logEvent('client', 'error.session_token_failed', errorData);
            throw new Error(`Failed to get session token: ${errorData.error}`);
        }
        
        const data = await response.json();
        logEvent('client', 'fetch_session_token_response', data);
        
        if (!data.client_secret?.value) {
            logEvent('client', 'error.no_ephemeral_key', data);
            console.error('No ephemeral key provided by the server:', data);
            throw new Error('No ephemeral key provided by the server');
        }
        
        console.log('Session token received');
        
        // Store the agent configuration if provided
        if (data.agentConfig) {
            window.agentConfig = data.agentConfig;
            //console.log('Received agent configuration:', data.agentConfig);
        }
        
        return data.client_secret.value;
    } catch (error) {
        console.error('Error fetching session token:', error);
        addMessage('system', `Error: ${error.message}`);
        setSessionStatus('DISCONNECTED');
        return null;
    }
}

// Create WebRTC connection
async function createRealtimeConnection(ephemeralKey) {
    console.log('Creating realtime connection...');
    
    // Create RTCPeerConnection with STUN server
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    // Set up event handlers for debugging
    pc.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', pc.iceConnectionState);
    };
    
    pc.onsignalingstatechange = () => {
        console.log('Signaling state:', pc.signalingState);
    };
    
    // Handle incoming audio tracks
    pc.ontrack = (event) => {
        console.log('Received track:', event.track.kind);
        
        if (event.track.kind === 'audio') {
            console.log('Received audio track, connecting to audio element');
            
            // Create a MediaStream and add the audio track
            const stream = new MediaStream();
            stream.addTrack(event.track);
            
            // Connect the stream to the audio element
            if (audioElement) {
                audioElement.srcObject = stream;
                
                // Force play the audio - important for browsers that block autoplay
                audioElement.play().catch(err => {
                    console.error('Error playing audio:', err);
                });
                
                console.log('Audio playback set up successfully');
                updateAudioStatus(true, audioElement.muted);
            }
        }
    };
    
    // Get user microphone audio
    try {
        console.log('Requesting microphone access...');
        const mediaStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            } 
        });
        
        console.log('Microphone access granted');
        
        // Add audio track to the connection
        const audioTrack = mediaStream.getAudioTracks()[0];
        pc.addTrack(audioTrack, mediaStream);
        console.log('Local audio track added to connection');
    } catch (error) {
        console.error('Error accessing microphone:', error);
        addMessage('system', `Error: ${error.message}`);
        throw error;
    }
    
    // Create data channel
    const dc = pc.createDataChannel('oai-events');
    console.log('Data channel created');
    
    // Create and set local description (offer)
    try {
        console.log('Creating SDP offer...');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log('Local description set');
        
        // Send offer to OpenAI
        console.log('Sending SDP offer to OpenAI...');
        const sdpResponse = await fetch(`https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17`, {
            method: 'POST',
            body: offer.sdp,
            headers: {
                'Authorization': `Bearer ${ephemeralKey}`,
                'Content-Type': 'application/sdp',
            }
        });
        
        if (!sdpResponse.ok) {
            console.error('OpenAI SDP response error:', sdpResponse.status, sdpResponse.statusText);
            const errorText = await sdpResponse.text();
            throw new Error(`OpenAI SDP error: ${sdpResponse.status} - ${errorText}`);
        }
        
        // Get and set remote description (answer)
        const answerSdp = await sdpResponse.text();
        console.log('Received SDP answer from OpenAI');
        
        const answer = {
            type: 'answer',
            sdp: answerSdp,
        };
        
        await pc.setRemoteDescription(answer);
        console.log('Remote description set successfully');
        
        return { pc, dc };
    } catch (error) {
        console.error('Error in WebRTC setup:', error);
        throw error;
    }
}

// Connect to OpenAI Realtime
async function connectToRealtime() {
    if (sessionStatus !== 'DISCONNECTED') return;
    
    setSessionStatus('CONNECTING');
    
    try {
        // Initialize audio element
        initAudioElement();
        
        // Get ephemeral key
        const ephemeralKey = await fetchSessionToken();
        if (!ephemeralKey) {
            throw new Error('Failed to get ephemeral key');
        }
        
        // Set up WebRTC connection
        const { pc, dc } = await createRealtimeConnection(ephemeralKey);
        peerConnection = pc;
        dataChannel = dc;
        
        // Set up data channel event handlers
        dc.addEventListener('open', () => {
            console.log('Data channel opened');
            logEvent('client', 'data_channel.open', {});
            
            setSessionStatus('CONNECTED');
            
            // After connection is established, update session
            setTimeout(() => {
                updateSession(true);
            }, 500);
        });
        
        dc.addEventListener('close', () => {
            console.log('Data channel closed');
            logEvent('client', 'data_channel.close', {});
            disconnectFromRealtime();
        });
        
        dc.addEventListener('error', (err) => {
            console.error('Data channel error:', err);
            logEvent('client', 'data_channel.error', { error: err });
        });
        
        dc.addEventListener('message', (e) => {
            try {
                const eventData = JSON.parse(e.data);
                handleServerEvent(eventData);
            } catch (error) {
                console.error('Error handling server message:', error);
            }
        });
        
    } catch (error) {
        console.error('Error connecting to realtime:', error);
        addMessage('system', `Connection error: ${error.message}`);
        setSessionStatus('DISCONNECTED');
    }
}

// Disconnect from OpenAI Realtime
function disconnectFromRealtime() {
    console.log('Disconnecting from realtime...');
    
    if (peerConnection) {
        // Stop all tracks
        peerConnection.getSenders().forEach((sender) => {
            if (sender.track) {
                sender.track.stop();
            }
        });
        
        peerConnection.close();
        peerConnection = null;
    }
    
    // Clean up audio
    if (audioElement) {
        if (audioElement.srcObject) {
            audioElement.srcObject.getTracks().forEach(track => track.stop());
            audioElement.srcObject = null;
        }
        audioElement.pause();
    }
    
    dataChannel = null;
    setSessionStatus('DISCONNECTED');
    isUserSpeaking = false;
    
    logEvent('client', 'disconnected', {});
    console.log('Disconnected from realtime');
}

// Send event to OpenAI
function sendClientEvent(eventObj, eventNameSuffix = '') {
    if (dataChannel && dataChannel.readyState === 'open') {
        const eventName = eventObj.type + (eventNameSuffix ? ` ${eventNameSuffix}` : '');
        console.log('Sending client event:', eventName);
        logEvent('client', eventName, eventObj);
        
        dataChannel.send(JSON.stringify(eventObj));
    } else {
        console.error('Cannot send event - data channel not open:', eventObj);
        logEvent('client', 'error.data_channel_not_open', { attemptedEvent: eventObj.type });
    }
}

// Update session configuration with agent instructions and tools
function updateSession(shouldTriggerResponse = false) {
    console.log('Updating session configuration');
    sendClientEvent({ type: 'input_audio_buffer.clear' }, 'clear audio buffer');
    
    // Use the agent configuration from the server if available
    // This would have been added to the window object in the fetchSessionToken function
    const agentConfig = window.agentConfig || {
        instructions: "You are a helpful voice assistant for a pizza restaurant.",
        tools: []
    };
    
    // Format tools for OpenAI Realtime API
    const formattedTools = (agentConfig.tools || []).map(tool => {
        return {
            type: "function",
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters
        };
    });
   
    //console.log(formattedTools)
    //console.log(`Using ${formattedTools.length} formatted tools`);
    
    const turnDetection = isPushToTalkActive
        ? null
        : {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 200,
            create_response: true,
          };
    
    const sessionUpdateEvent = {
        type: 'session.update',
        session: {
            modalities: ['text', 'audio'],
            instructions: agentConfig.instructions,
            voice: 'shimmer',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: turnDetection,
            tools: formattedTools,
        },
    };
    
    console.log('Sending session update event');
    sendClientEvent(sessionUpdateEvent);
    
    if (shouldTriggerResponse) {
        setTimeout(() => {
            console.log('Sending initial greeting message');
            //sendSimulatedUserMessage('hi');
        }, 1000);
    }
}

// Send a text message
function sendTextMessage() {
    const text = messageInput.value.trim();
    if (!text || sessionStatus !== 'CONNECTED') return;
    
    // Cancel any ongoing response
    if (isResponding) {
        cancelAssistantSpeech();
    }
    
    const id = 'msg-' + Date.now();
    addMessage('user', text);
    
    sendClientEvent({
        type: 'conversation.item.create',
        item: {
            id,
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text }],
        },
    }, 'user text message');
    
    messageInput.value = '';
    
    // Use the safe request function with a delay
    setTimeout(() => {
        requestResponse();
    }, 500);
}

// Send a simulated user message
function sendSimulatedUserMessage(text) {
    const id = 'msg-' + Date.now();
    addMessage('user', text);
    
    console.log('Sending simulated user message:', text);
    
    sendClientEvent({
        type: 'conversation.item.create',
        item: {
            id,
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text }],
        },
    }, 'simulated user message');
    
    setTimeout(() => {
        console.log('Triggering response after simulated message');
        sendClientEvent({ type: 'response.create' }, 'trigger response');
    }, 500);
}

// Handle push-to-talk button press
function handleTalkButtonDown() {
    if (sessionStatus !== 'CONNECTED' || !dataChannel || dataChannel.readyState !== 'open') return;
    
    cancelAssistantSpeech();
    
    isUserSpeaking = true;
    talkBtn.classList.add('active');
    sendClientEvent({ type: 'input_audio_buffer.clear' }, 'clear PTT buffer');
}

// Handle push-to-talk button release
function handleTalkButtonUp() {
    if (sessionStatus !== 'CONNECTED' || !dataChannel || dataChannel.readyState !== 'open' || !isUserSpeaking) return;
    
    isUserSpeaking = false;
    talkBtn.classList.remove('active');
    
    console.log('Committing audio buffer');
    sendClientEvent({ type: 'input_audio_buffer.commit' }, 'commit PTT');
    
    setTimeout(() => {
        console.log('Triggering response after PTT');
        sendClientEvent({ type: 'response.create' }, 'trigger response PTT');
    }, 300);
}

// Cancel current assistant speech
function cancelAssistantSpeech() {
    if (!isResponding) {
        console.log('No active response to cancel');
        return;
    }
    
    console.log('Cancelling assistant speech');
    
    // Find the most recent assistant message
    const assistantMessages = document.querySelectorAll('.assistant-message');
    if (assistantMessages.length > 0) {
        const latestMessage = assistantMessages[assistantMessages.length - 1];
        const messageId = latestMessage.dataset.oaiId;
        
        if (messageId) {
            try {
                // Try to truncate the message
                sendClientEvent({
                    type: 'conversation.item.truncate',
                    item_id: messageId,
                    content_index: 0,
                    audio_end_ms: Date.now() - parseInt(latestMessage.dataset.createdAt || 0),
                });
            } catch (error) {
                console.error('Error truncating message:', error);
            }
        }
    }
    
    try {
        // Cancel the response
        sendClientEvent({ type: 'response.cancel' });
    } catch (error) {
        console.error('Error cancelling response:', error);
    }
    
    // Reset the responding state after a short delay
    setTimeout(() => {
        isResponding = false;
        processQueuedResponses();
    }, 500);
}

function requestResponse() {
    if (isResponding) {
        console.warn("Cannot create new response while one is active");
        // Queue this request to be executed later
        responseQueue.push(Date.now());
        return;
    }
    
    try {
        isResponding = true;
        console.log('Requesting new response');
        sendClientEvent({ type: 'response.create' });
    } catch (error) {
        console.error('Error requesting response:', error);
        isResponding = false;
        processQueuedResponses();
    }
}

function processQueuedResponses() {
    if (responseQueue.length > 0 && !isResponding) {
        console.log(`Processing queued response request (${responseQueue.length} in queue)`);
        // Remove the oldest request
        responseQueue.shift();
        // Request a new response
        setTimeout(() => {
            requestResponse();
        }, 300);
    }
}

// Update session status
function setSessionStatus(status) {
    console.log('Setting session status:', status);
    sessionStatus = status;
    updateUIForSessionStatus();
    
    if (status === 'CONNECTED') {
        addMessage('system', 'Connected to OpenAI Realtime API');
    } else if (status === 'DISCONNECTED') {
        addMessage('system', 'Disconnected from OpenAI Realtime API');
    }
}

// Handle events from OpenAI
function handleServerEvent(serverEvent) {
    //console.log('server', serverEvent.type, serverEvent);
    //console.log('Received server event:', serverEvent.type);
    
    switch (serverEvent.type) {
        case 'response.started': {
            isResponding = true;
            break;
        }
        
        case 'response.done': {
            isResponding = false;
            // Process any queued responses
            setTimeout(processQueuedResponses, 500);
            break;
        }

        case 'session.created': {
            if (serverEvent.session?.id) {
                //console.log('Session created with ID:', serverEvent.session.id);
                // Don't set status to CONNECTED here - wait for data channel to open
            }
            break;
        }
        
        case 'response.output_item.done': {
            const itemId = serverEvent.item?.id;
            if (itemId) {
                // Update the message status to done
                const messages = Array.from(document.querySelectorAll('.message'));
                const message = messages.find(m => m.dataset.oaiId === itemId);
                if (message) {
                    message.dataset.status = 'DONE';
                }
            }
            break;
        }

        case 'conversation.item.created': {
            let text = serverEvent.item?.content?.[0]?.text || 
                      serverEvent.item?.content?.[0]?.transcript || '';
            const role = serverEvent.item?.role;
            const itemId = serverEvent.item?.id;
            
            if (itemId && role) {
                if (role === 'user' && !text) {
                    text = '[Transcribing...]';
                }
                
                //console.log(`Message created (${role}):`, text);
                
                const messageId = addMessage(role, text);
                if (messageId) {
                    document.getElementById(messageId).dataset.oaiId = itemId;
                    document.getElementById(messageId).dataset.createdAt = Date.now();
                }
                
                if (role === 'assistant') {
                    isAssistantSpeaking = true; // Mark that assistant is speaking
                }
            }
            break;
        }
        
        case 'conversation.item.input_audio_transcription.completed': {
            const itemId = serverEvent.item_id;
            const finalTranscript = !serverEvent.transcript || serverEvent.transcript === '\n'
                ? '[inaudible]'
                : serverEvent.transcript;
                
            //console.log('Transcription completed:', finalTranscript);
                
            // Find message with matching OpenAI ID
            const messages = Array.from(document.querySelectorAll('.message'));
            const message = messages.find(m => m.dataset.oaiId === itemId);
            
            if (message) {
                updateMessage(message.id, finalTranscript, false);
                
                // Important: Explicitly trigger a response after transcription
                setTimeout(() => {
                    //console.log('Triggering response after transcription');
                    requestResponse(); // Use safe request method
                }, 300);
            }
            break;
        }
        
        case 'response.audio_transcript.delta': {
            const itemId = serverEvent.item_id;
            const deltaText = serverEvent.delta || '';
            
            // Find message with matching OpenAI ID
            const messages = Array.from(transcript.querySelectorAll('.message'));
            const message = messages.find(m => m.dataset.oaiId === itemId);
            
            if (message) {
                updateMessage(message.id, deltaText, true);
            }
            break;
        }
        
        case 'response.audio.received': {
            //console.log('Audio response received');
            updateAudioStatus(true, audioElement ? audioElement.muted : false);
            break;
        }
        
        case 'response.function_call_arguments.done': {
            console.log('Function call arguments complete:', serverEvent);
            
            // The event already contains everything we need!
            const functionCall = {
                name: serverEvent.name,
                arguments: serverEvent.arguments,
                call_id: serverEvent.call_id
            };
            
            // Process the function call
            handleFunctionCall(functionCall);
            break;
        }
        
        // We still track deltas for debugging, but don't need to accumulate them
        case 'response.function_call_arguments.delta': {
            //console.log('Function arguments delta:', serverEvent.delta);
            break;
        }
        
        // Record when a function call starts
        case 'response.function_call.started': {
            //console.log('Function call started:', serverEvent);
            break;
        }
        
        case 'function_call_result': {
            // Result of a function call
            console.log('Function call result received:', serverEvent);
            // No special handling needed, just log it
            break;
        }
        
        case 'error': {
            // Handle specific errors
            if (serverEvent.error?.code === 'conversation_already_has_active_response') {
                console.warn('Cannot create response, one is already active');
                isResponding = true;
            }
            else if (serverEvent.error?.code === 'response_cancel_not_active') {
                isResponding = false;
                // Process any queued responses
                setTimeout(processQueuedResponses, 500);
            }
            
            console.error('API error:', serverEvent);
            break;
        }
    }
}

// Add a handler for function calls
function handleFunctionCall(functionCall) {
    console.log(`Handling function call: ${functionCall.name}`, functionCall);
    
    if (!functionCall || !functionCall.name) {
        console.error('Invalid function call received:', functionCall);
        return;
    }
    
    let functionArgs;
    try {
        functionArgs = JSON.parse(functionCall.arguments);
        console.log('Parsed arguments:', functionArgs);
    } catch (error) {
        console.error('Error parsing function arguments:', error);
        functionArgs = {};
    }
    
    let result = null;
    
    switch (functionCall.name) {
        case 'add_to_cart':
            console.log('Adding to cart:', functionArgs);
            result = handleAddToCartAction(functionArgs);
            break;
            
        case 'modify_cart_item':
            console.log('Modifying cart item:', functionArgs);
            result = handleModifyCartItemAction(functionArgs);
            break;
            
        case 'remove_from_cart':
            console.log('Removing from cart:', functionArgs);
            result = handleRemoveFromCartAction(functionArgs);
            break;
            
        case 'clear_cart':
            console.log('Clearing cart');
            result = handleClearCartAction();
            break;
            
        case 'checkout':
            console.log('Processing checkout:', functionArgs);
            result = handleCheckoutAction(functionArgs);
            break;
        
        case 'update_customer_phone_number':
            console.log('Updating customer phone:', functionArgs);
            result = handleCustomerPhone(functionArgs);
            break;
        
        case 'update_customer_address':
            console.log('Updating customer address:', functionArgs);
            result = handleCustomerAddress(functionArgs);
            break;

        case 'update_customer_name':
            console.log('Updating customer name:', functionArgs);
            result = handleCustomerName(functionArgs);
            break;
            
        default:
            console.warn('Unknown function name:', functionCall.name);
            result = { error: `Unknown function: ${functionCall.name}` };
    }
    
    // Send function result back to OpenAI, including the call_id
    console.log('Sending function result:', result);
    sendFunctionResult(functionCall.name, result, functionCall.call_id);
}

// Send function result back to OpenAI
function sendFunctionResult(functionName, result, callId) {
    if (dataChannel && dataChannel.readyState === 'open') {
        const content = typeof result === 'string' ? result : JSON.stringify(result);
        
        const functionCallOutput = {
            type: "conversation.item.create",
            item: {
                type: "function_call_output",
                //function_name: functionName,
                call_id: callId, // Include the call_id
                output: content
            }
        };
        
        console.log('Sending function call output:', functionName);
        dataChannel.send(JSON.stringify(functionCallOutput));
        
        // Trigger a response after sending the function result
        setTimeout(() => {
            requestResponse();
        }, 300);
    } else {
        console.error('Cannot send function result - data channel not open');
    }
}

// Create audio buffer from binary data
function createAudioBuffer(data) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Convert ArrayBuffer to Int16Array (PCM format)
    const audioDataView = new Int16Array(data);
    
    if (audioDataView.length === 0) {
        console.error("Received audio data is empty.");
        return null;
    }
    
    // Create buffer with correct sample rate (usually 24000 for OpenAI output)
    const buffer = audioContext.createBuffer(1, audioDataView.length, 24000);
    const channelData = buffer.getChannelData(0);
    
    // Convert Int16 PCM to float [-1, 1]
    for (let i = 0; i < audioDataView.length; i++) {
        channelData[i] = audioDataView[i] / 32768;
    }
    
    return buffer;
}

// Play audio response from agent
function playAudioResponse(audioBlob) {
    // Convert blob to ArrayBuffer
    audioBlob.arrayBuffer().then(arrayBuffer => {
        // Create and play the audio buffer
        const audioBuffer = createAudioBuffer(arrayBuffer);
        if (audioBuffer) {
            playAudioBuffer(audioBuffer);
        }
    }).catch(error => {
        console.error("Error processing audio data:", error);
    });
}

// Play audio buffer
function playAudioBuffer(buffer) {
    if (!buffer) return null;
    
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    
    const currentTime = audioContext.currentTime;
    if (startTimeRef.current < currentTime) {
        startTimeRef.current = currentTime;
    }
    
    source.start(startTimeRef.current);
    startTimeRef.current += buffer.duration;
    
    // Keep track of source for possible cleanup
    scheduledAudioSources.push(source);
    
    return source;
}

// Stop all audio playback
function stopAllAudio() {
    console.log("User interrupted - stopping audio playback");
    
    // Stop all scheduled audio sources
    if (scheduledAudioSources && scheduledAudioSources.length > 0) {
        scheduledAudioSources.forEach(source => {
            try {
                if (source) {
                    source.stop();
                }
            } catch (err) {
                // Ignore errors if source is already stopped
            }
        });
        
        // Clear the sources array
        scheduledAudioSources = [];
    }
    
    // Reset the start time reference
    startTimeRef.current = 0;
}

// Start recording
async function startRecording() {
    try {
        // First check if the connection is ready
        if (!webSocket || webSocket.readyState !== WebSocket.OPEN || sessionStatus !== 'CONNECTED') {
            updateStatus("Error: Not connected to server");
            return;
        }
        
        // Disable the button while preparing
        startButton.disabled = true;
        updateStatus("Initializing microphone...");
        
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Request microphone access
        microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Create audio processing pipeline
        const source = audioContext.createMediaStreamSource(microphoneStream);
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        // Update UI
        isConversationActive = true;
        startButton.textContent = "Stop Listening";
        startButton.classList.add('recording');
        startButton.disabled = false;
        microphoneIndicator.classList.add('active');
        updateStatus("Listening...");
        
        // Process audio data
        // Process audio data
        processor.onaudioprocess = (e) => {
            if (isConversationActive && webSocket && webSocket.readyState === WebSocket.OPEN) {
                // Get audio data from input channel
                const inputData = e.inputBuffer.getChannelData(0);
                
                // Downsample to 16kHz
                const downsampledData = downsampleAudio(inputData, audioContext.sampleRate, 16000);
                
                // Convert to Int16 format for sending
                const convertedData = convertFloat32ToInt16(downsampledData);
                
                // Send to server
                dataChannel.send(convertedData);
            }
        };
    } catch (error) {
        console.error('Error starting recording:', error);
        updateStatus(`Microphone error: ${error.message}`);
        startButton.disabled = false;
    }
}

// Stop recording
function stopRecording() {
    if (processor) {
        processor.disconnect();
        processor = null;
    }
    
    if (microphoneStream) {
        microphoneStream.getTracks().forEach(track => track.stop());
        microphoneStream = null;
    }
    
    // Update UI
    isConversationActive = false;
    startButton.textContent = "Start Conversation";
    startButton.classList.remove('recording');
    microphoneIndicator.classList.remove('active');
    updateStatus("Paused. Click 'Start Conversation' to continue.");
}

// Convert Float32Array to Int16Array
function convertFloat32ToInt16(buffer) {
    let l = buffer.length;
    const buf = new Int16Array(l);
    
    while (l--) {
        buf[l] = Math.min(1, buffer[l]) * 0x7FFF;
    }
    
    return buf.buffer;
}

// Downsampling function to convert audio from browser sample rate to target sample rate
function downsampleAudio(buffer, fromSampleRate, toSampleRate) {
    if (fromSampleRate === toSampleRate) {
        return buffer;
    }
    
    const sampleRateRatio = fromSampleRate / toSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    
    let offsetResult = 0;
    let offsetBuffer = 0;
    
    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
        let accum = 0;
        let count = 0;
        
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        
        result[offsetResult] = accum / count;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    
    return result;
}

// Update status message
function updateStatus(message) {
    statusElement.textContent = message;
}

// Cart management functions
function addToCart(item) {
    debugLog(`Adding to cart: ${item.name}`, item);
    
    // Add item to cart
    cart.push(item);
    totalPrice += item.totalPrice;
    
    // Update UI
    updateCartUI();
}

function removeFromCart(itemId) {
    debugLog(`Removing from cart: ${itemId}`);
    
    const index = cart.findIndex(item => item.id === itemId);
    
    if (index !== -1) {
        // Subtract price from total
        totalPrice -= cart[index].totalPrice;
        
        // Remove item
        cart.splice(index, 1);
        
        // Update UI
        updateCartUI();
    }
}

function clearCart() {
    cart = [];
    totalPrice = 0;
    updateCartUI();
    
    // Show confirmation notification
    showClearCartConfirmation();
}

function updateCartUI() {
    // Clear cart items
    cartItemsElement.innerHTML = '';
    
    // Add each item
    cart.forEach(item => {
        const cartItemElement = document.createElement('div');
        cartItemElement.classList.add('cart-item');
        
        const quantityText = item.quantity > 1 ? `${item.quantity}x ` : '';
        
        cartItemElement.innerHTML = `
            <div class="cart-item-details">
                <div class="cart-item-title">${quantityText}${item.name}</div>
                ${item.size ? `<div class="cart-item-customization">${item.size}</div>` : ''}
                ${item.customizations && item.customizations.length > 0 ? 
                    `<div class="cart-item-customization">${item.customizations.join(', ')}</div>` : ''}
            </div>
            <div class="cart-item-price">$${item.totalPrice.toFixed(2)}</div>
        `;
        
        cartItemsElement.appendChild(cartItemElement);
    });
    
    // Update total
    cartTotalElement.innerHTML = `
        <span>Total:</span>
        <span>$${totalPrice.toFixed(2)}</span>
    `;
    
    // Update item count
    const totalItems = cart.reduce((total, item) => total + (item.quantity || 1), 0);
    itemCountElement.textContent = `${totalItems} item${totalItems !== 1 ? 's' : ''}`;
    
    debugLog(`Cart updated: ${totalItems} items, total: $${totalPrice.toFixed(2)}`);
}

// Function action handlers
function handleAddToCartAction(args) {
    console.log('Adding to cart:', args);
    
    // Find the menu item in our data
    const item = findMenuItem(args.item, window.restaurantData);
    
    if (!item) {
        console.error('Item not found:', args.item);
        return { success: false, error: `Item "${args.item}" not found` };
    }
    
    // Create the cart item
    const cartItem = {
        id: args.id || item.id || `item_${Date.now()}`,
        name: item.name,
        price: item.price,
        description: item.description,
        quantity: args.quantity || 1,
        size: args.size || null,
        customizations: args.customizations || []
    };
    
    // Calculate the total price
    cartItem.totalPrice = calculateItemPrice(cartItem);
    
    // Add to cart
    addToCart(cartItem);
    
    // Show visual confirmation
    showOrderConfirmation(cartItem);
    
    // Return success result
    return { 
        success: true, 
        item: {
            id: cartItem.id,
            name: cartItem.name,
            price: cartItem.price,
            quantity: cartItem.quantity,
            size: cartItem.size,
            customizations: cartItem.customizations,
            totalPrice: cartItem.totalPrice
        }
    };
}

function handleModifyCartItemAction(args) {
    console.log('Modifying cart item:', args);
    
    if (!args.item) {
        console.error('No item specified for modification');
        return { success: false, error: 'No item specified for modification' };
    }
    
    // Find the item in the cart by name
    const itemIndex = cart.findIndex(item => 
        item.name && item.name.toLowerCase() === args.item.toLowerCase());
    
    if (itemIndex === -1) {
        console.error('Item not found in cart:', args.item);
        return { success: false, error: `Item "${args.item}" not found in cart` };
    }
    
    const cartItem = cart[itemIndex];
    const oldTotalPrice = cartItem.totalPrice;
    
    // Apply changes
    if (args.changes) {
        if (args.changes.quantity !== undefined) {
            cartItem.quantity = args.changes.quantity;
        }
        
        if (args.changes.size !== undefined) {
            cartItem.size = args.changes.size;
        }
        
        if (args.changes.customizations !== undefined) {
            cartItem.customizations = args.changes.customizations;
        }
    }
    
    // Recalculate price
    cartItem.totalPrice = calculateItemPrice(cartItem);
    
    // Update total price
    totalPrice = totalPrice - oldTotalPrice + cartItem.totalPrice;
    
    // Update cart UI
    updateCartUI();
    
    // Show confirmation
    showModificationConfirmation(cartItem);
    
    // Return success result
    return { 
        success: true, 
        item: {
            id: cartItem.id,
            name: cartItem.name,
            changes: args.changes,
            totalPrice: cartItem.totalPrice
        }
    };
}

function handleRemoveFromCartAction(args) {
    console.log('Removing from cart:', args);
    
    if (!args.item) {
        console.error('No item specified for removal');
        return { success: false, error: 'No item specified for removal' };
    }
    
    // Find the item in the cart by name
    const itemIndex = cart.findIndex(item => 
        item.name && item.name.toLowerCase() === args.item.toLowerCase());
    
    if (itemIndex === -1) {
        console.error('Item not found in cart:', args.item);
        return { success: false, error: `Item "${args.item}" not found in cart` };
    }
    
    const cartItem = cart[itemIndex];
    
    // Remove from cart
    removeFromCart(cartItem.id);
    
    // Show confirmation
    showRemovalConfirmation(cartItem);
    
    // Return success result
    return { 
        success: true, 
        item: {
            name: cartItem.name,
            id: cartItem.id
        }
    };
}

function handleClearCartAction() {
    console.log('Clearing cart');
    
    // Get cart size before clearing
    const itemCount = cart.length;
    
    // Clear the cart
    clearCart();
    
    // Return success result
    return { 
        success: true, 
        itemsRemoved: itemCount
    };
}

function handleCustomerName(args) {
    console.log('Updating customer name:', args);
    customerName = args.name;
    
    return { 
        success: true
    };
}

function handleCustomerAddress(args) {
    console.log('Updating customer address:', args);
    customerAddress = args.address;

    return { 
        success: true
    };
}

function handleCustomerPhone(args) {
    console.log('Updating customer phone:', args);
    customerPhone = args.phone;
    
    return { 
        success: true
    };
}

function handleCheckoutAction(args) {
    console.log('Starting checkout:', args);
    
    if (cart.length === 0) {
        return { success: false, error: 'Cart is empty' };
    }
    
    // Start the checkout process
    startCheckout();
    
    // Return success
    return { 
        success: true,
        cart: cart.map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            totalPrice: item.totalPrice
        })),
        total: totalPrice
    };
}

// Utility functions
function calculateItemPrice(item) {
    if (!item) return 0;
    
    let basePrice = item.price || 0;
    
    // Adjust for size if applicable
    if (item.size && window.restaurantData && window.restaurantData.customizations && 
        window.restaurantData.customizations.sizes) {
        
        const sizeData = window.restaurantData.customizations.sizes.find(
            s => s.name.toLowerCase() === item.size.toLowerCase());
        
        if (sizeData && sizeData.adjustmentFactor) {
            basePrice *= sizeData.adjustmentFactor;
        }
    }
    
    // Add cost for customizations
    let additionalCost = 0;
    
    if (item.customizations && item.customizations.length > 0 && 
        window.restaurantData && window.restaurantData.customizations &&
        window.restaurantData.customizations.toppings) {
        
        for (const customization of item.customizations) {
            if (!customization) continue;
            
            // Handle cases where customization might be an object or a string
            const customizationName = typeof customization === 'string' ? 
                customization : (customization.name || '');
            
            const toppingData = window.restaurantData.customizations.toppings.find(
                t => t.name && t.name.toLowerCase() === customizationName.toLowerCase());
            
            if (toppingData && toppingData.price) {
                additionalCost += toppingData.price;
            }
        }
    }
    
    // Calculate total based on quantity
    return parseFloat(((basePrice + additionalCost) * (item.quantity || 1)).toFixed(2));
}

function findMenuItem(name, data = window.restaurantData) {
    if (!name) return null;
    if (!data || !data.menu) return null;
    
    const searchName = name.toLowerCase();
    
    // Search in each menu category
    for (const category of ['pizzas', 'sides', 'drinks', 'desserts']) {
        const items = data.menu[category];
        if (!items) continue;
        
        const found = items.find(item => item.name.toLowerCase() === searchName);
        if (found) return found;
    }
    
    // Check for alternative names
    if (data.menuKeywords) {
        for (const [keyword, variants] of Object.entries(data.menuKeywords)) {
            if (keyword.toLowerCase() === searchName) {
                const id = variants[0];
                
                // Search for item by ID
                for (const category of ['pizzas', 'sides', 'drinks', 'desserts']) {
                    const items = data.menu[category];
                    if (!items) continue;
                    
                    const found = items.find(item => item.id === id);
                    if (found) return found;
                }
            }
        }
    }
    
    return null;
}

// UI Notifications for cart actions
function showOrderConfirmation(item) {
    // Create a notification element
    const notification = document.createElement('div');
    notification.classList.add('order-notification');
    notification.classList.add('added');
    
    // Format the item details
    const sizeTxt = item.size ? `${item.size} ` : '';
    const customizationsTxt = item.customizations && item.customizations.length > 0 
        ? ` with ${item.customizations.join(', ')}` 
        : '';
    
    notification.innerHTML = `
        <div class="notification-icon">✓</div>
        <div class="notification-text">
            Added ${item.quantity}x ${sizeTxt}${item.name}${customizationsTxt}
        </div>
    `;
    
    // Add to the page
    document.body.appendChild(notification);
    
    // Animate in, then remove after a delay
    setTimeout(() => {
        notification.classList.add('show');
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 2000);
    }, 10);
    
    // Highlight the cart section
    highlightCartSection();
}

function showModificationConfirmation(item) {
    // Create a notification element
    const notification = document.createElement('div');
    notification.classList.add('order-notification');
    notification.classList.add('modified');
    
    notification.innerHTML = `
        <div class="notification-icon">✓</div>
        <div class="notification-text">
            Updated ${item.name} in your cart
        </div>
    `;
    
    // Add to the page
    document.body.appendChild(notification);
    
    // Animate in, then remove after a delay
    setTimeout(() => {
        notification.classList.add('show');
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 2000);
    }, 10);
    
    // Highlight the cart section
    highlightCartSection();
}

function showRemovalConfirmation(item) {
    // Create a notification element
    const notification = document.createElement('div');
    notification.classList.add('order-notification');
    notification.classList.add('removed');
    
    notification.innerHTML = `
        <div class="notification-icon">✓</div>
        <div class="notification-text">
            Removed ${item.name} from your cart
        </div>
    `;
    
    // Add to the page
    document.body.appendChild(notification);
    
    // Animate in, then remove after a delay
    setTimeout(() => {
        notification.classList.add('show');
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 2000);
    }, 10);
    
    // Highlight the cart section
    highlightCartSection();
}

function showClearCartConfirmation() {
    // Create a notification element
    const notification = document.createElement('div');
    notification.classList.add('order-notification');
    notification.classList.add('cleared');
    
    notification.innerHTML = `
        <div class="notification-icon">✓</div>
        <div class="notification-text">
            Your cart has been cleared
        </div>
    `;
    
    // Add to the page
    document.body.appendChild(notification);
    
    // Animate in, then remove after a delay
    setTimeout(() => {
        notification.classList.add('show');
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 2000);
    }, 10);
    
    // Highlight the cart section
    highlightCartSection();
}

function highlightCartSection() {
    const cartContainer = document.querySelector('.cart-container');
    if (cartContainer) {
        cartContainer.classList.add('highlight');
        
        setTimeout(() => {
            cartContainer.classList.remove('highlight');
        }, 1500);
    }
}

// Checkout function
function startCheckout() {
    if (cart.length === 0) {
        alert('Your cart is empty. Add some items before checkout.');
        return;
    }
    
    // Create a confirmation modal
    const modal = document.createElement('div');
    modal.classList.add('checkout-modal');
    
    const modalContent = document.createElement('div');
    modalContent.classList.add('modal-content');
    
    // Build order summary
    let orderSummary = '<h2>Order Summary</h2>';
    orderSummary += '<div class="order-items">';
    
    cart.forEach(item => {
        const sizeTxt = item.size ? `${item.size} ` : '';
        const customizationsTxt = item.customizations && item.customizations.length > 0 
            ? ` with ${item.customizations.join(', ')}` 
            : '';
            
        orderSummary += `
            <div class="order-item">
                <div class="order-item-details">
                    <span class="order-item-quantity">${item.quantity}x</span>
                    <span class="order-item-name">${sizeTxt}${item.name}${customizationsTxt}</span>
                </div>
                <div class="order-item-price">$${item.totalPrice.toFixed(2)}</div>
            </div>
        `;
    });
    
    orderSummary += '</div>';
    
    // Add delivery info if applicable
    if (window.restaurantData && window.restaurantData.delivery) {
        orderSummary += `
            <div class="delivery-info">
                <div class="delivery-row">
                    <span>Subtotal:</span>
                    <span>$${totalPrice.toFixed(2)}</span>
                </div>
                <div class="delivery-row">
                    <span>Delivery Fee:</span>
                    <span>$${window.restaurantData.delivery.fee.toFixed(2)}</span>
                </div>
                <div class="delivery-row total">
                    <span>Total:</span>
                    <span>$${(totalPrice + window.restaurantData.delivery.fee).toFixed(2)}</span>
                </div>
                <div class="delivery-note">
                    Estimated delivery time: ${window.restaurantData.delivery.estimatedTime}
                </div>
            </div>
        `;
    } else {
        orderSummary += `
            <div class="order-total">
                <span>Total:</span>
                <span>$${totalPrice.toFixed(2)}</span>
            </div>
        `;
    }
    
    // Add checkout form
    const checkoutForm = `
        <div class="checkout-form">
            <h3>Delivery Information</h3>
            <div class="form-group">
                <label for="name">Name</label>
                <input type="text" id="name" placeholder="Your Name" value="${customerName || ''}">
            </div>
            <div class="form-group">
                <label for="phone">Phone</label>
                <input type="tel" id="phone" placeholder="Phone Number" value="${customerPhone || ''}">
            </div>
            <div class="form-group">
                <label for="address">Address</label>
                <input type="text" id="address" placeholder="Delivery Address" value="${customerAddress || ''}">
            </div>
            <div class="form-buttons">
                <button id="cancelCheckout" class="cancel-btn">Cancel</button>
                <button id="confirmOrder" class="confirm-btn">Confirm Order</button>
            </div>
        </div>
    `;
    
    modalContent.innerHTML = orderSummary + checkoutForm;
    modal.appendChild(modalContent);
    
    // Add to page
    document.body.appendChild(modal);
    
    // Set up event listeners
    document.getElementById('cancelCheckout').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    document.getElementById('confirmOrder').addEventListener('click', () => {
        // Get form values
        const name = document.getElementById('name').value;
        const phone = document.getElementById('phone').value;
        const address = document.getElementById('address').value;
        
        // Basic validation
        if (!name || !phone || !address) {
            alert('Please fill out all fields');
            return;
        }
        
        // Update customer info
        customerName = name;
        customerPhone = phone;
        customerAddress = address;
        
        // Clear cart
        cart = [];
        totalPrice = 0;
        updateCartUI();
        
        // Replace modal content with confirmation
        modalContent.innerHTML = `
            <div class="order-confirmation">
                <div class="confirmation-icon">✓</div>
                <h2>Order Confirmed!</h2>
                <p>Thank you for your order, ${name}.</p>
                <p>We'll deliver to ${address} within ${window.restaurantData?.delivery?.estimatedTime || '30-45 minutes'}.</p>
                <p>A confirmation has been sent to your phone at ${phone}.</p>
                <button id="closeConfirmation" class="confirm-btn">Close</button>
            </div>
        `;
        
        // Set up close button
        document.getElementById('closeConfirmation').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
    });
    
    return { success: true };
}

// Add notification styles dynamically
function addNotificationStyles() {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        .order-notification {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%) translateY(100px);
            background-color: #4361ee;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            opacity: 0;
            transition: transform 0.3s ease, opacity 0.3s ease;
            z-index: 1000;
        }
        
        .order-notification.show {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }
        
        .order-notification.added {
            background-color: #4361ee;
        }
        
        .order-notification.modified {
            background-color: #ff9500;
        }
        
        .order-notification.removed {
            background-color: #e71d36;
        }
        
        .order-notification.cleared {
            background-color: #e71d36;
        }
        
        .notification-icon {
            font-size: 20px;
            margin-right: 12px;
        }
        
        .notification-text {
            font-weight: 500;
        }
        
        .cart-container.highlight {
            animation: pulse-highlight 1.5s ease-in-out;
        }
        
        @keyframes pulse-highlight {
            0% { box-shadow: 0 0 0 0 rgba(67, 97, 238, 0.7); }
            50% { box-shadow: 0 0 0 10px rgba(67, 97, 238, 0); }
            100% { box-shadow: 0 0 0 0 rgba(67, 97, 238, 0); }
        }

        .checkout-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        
        .modal-content {
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            width: 500px;
            max-width: 90%;
            max-height: 90%;
            overflow-y: auto;
        }
        
        .order-items {
            margin: 20px 0;
        }
        
        .order-item {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid #f1f1f1;
        }
        
        .order-item-quantity {
            margin-right: 8px;
            font-weight: bold;
        }
        
        .delivery-info {
            margin-top: 20px;
            padding-top: 15px;
            border-top: 2px solid #e9ecef;
        }
        
        .delivery-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
        }
        
        .delivery-row.total {
            font-weight: bold;
            font-size: 1.2em;
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid #e9ecef;
        }
        
        .delivery-note {
            font-style: italic;
            color: #666;
            margin-top: 10px;
        }
        
        .checkout-form {
            margin-top: 30px;
        }
        
        .form-group {
            margin-bottom: 15px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
        }
        
        .form-group input {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
        }
        
        .form-buttons {
            display: flex;
            justify-content: space-between;
            margin-top: 25px;
        }
        
        .cancel-btn {
            background-color: #f1f1f1;
            color: #333;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
        }
        
        .confirm-btn {
            background-color: #4361ee;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
        }

        .order-confirmation {
            text-align: center;
            padding: 20px 0;
        }
        
        .confirmation-icon {
            font-size: 60px;
            color: #4CAF50;
            margin-bottom: 20px;
        }
    `;
    
    document.head.appendChild(styleElement);
}

// Start button click handler
startButton.addEventListener('click', function() {
    if (!isConversationActive) {
        startRecording();
    } else {
        stopRecording();
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // Add checkout button
    const checkoutButton = document.createElement('button');
    checkoutButton.id = 'checkoutButton';
    checkoutButton.classList.add('checkout-btn');
    checkoutButton.textContent = 'Proceed to Checkout';
    checkoutButton.onclick = startCheckout;
    
    // Add button after cart total
    if (cartTotalElement) {
        cartTotalElement.parentNode.insertBefore(checkoutButton, cartTotalElement.nextSibling);
    }
    
    // Add notification styles
    addNotificationStyles();
    
    // Connect to server
    connectToServer();
    
    // Initialize cart UI
    updateCartUI();
});

// Connect to WebSocket server
function connectToServer() {
    // Use secure WebSocket if page is served over HTTPS
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    webSocket = new WebSocket(wsUrl);
    
    webSocket.onopen = () => {
        console.log('Connected to WebSocket server');
        updateStatus('Connected. Ready to initialize agent...');
        // No need to call initializeAgent here - we'll do that after getting the session token
    };
    
    webSocket.onclose = () => {
        console.log('Disconnected from WebSocket server');
        updateStatus('Disconnected. Refresh page to reconnect.');
        startButton.disabled = true;
        isConversationActive = false;
    };
    
    webSocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateStatus('Connection error. See console for details.');
    };
    
    webSocket.onmessage = handleServerMessage;
}

// Handle messages from the server
function handleServerMessage(event) {
    // Check if the message is binary (audio) or text (JSON)
    if (event.data instanceof Blob) {
        // Binary data - agent audio response
        playAudioResponse(event.data);
    } else {
        // Text data - parse as JSON
        try {
            const message = JSON.parse(event.data);
            
            switch (message.type) {
                case 'status':
                    handleStatusMessage(message);
                    break;
                case 'transcript':
                    handleTranscriptMessage(message);
                    break;
                case 'actions':
                    handleActionMessage(message);
                    break;
                case 'error':
                    handleErrorMessage(message);
                    break;
                case 'audioComplete':
                    // Agent finished speaking
                    break;
                case 'userStartedSpeaking':
                    // User started speaking - stop all audio playback
                    stopAllAudio();
                    break;
                case 'function_call_result':
                    // Result of a function call
                    console.log('Function call result received:', message);
                    // No special handling needed here, just log it
                    break;
                default:
                    console.log('Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    }
}

// Handle status messages
function handleStatusMessage(message) {
    console.log('Status message:', message);
    
    if (message.message) {
        updateStatus(message.message);
    }
    
    if (message.status === 'ready') {
        startButton.disabled = false;
    } else if (message.status === 'closed') {
        stopRecording();
        startButton.disabled = true;
    } else if (message.status === 'not_ready') {
        // Agent not ready, stop recording if it was started
        if (isConversationActive) {
            stopRecording();
        }
    }
}

// Handle transcript messages
function handleTranscriptMessage(message) {
    console.log('Transcript:', message.data);
    
    // Check if this is user or agent transcript
    if (message.data.speaker === 'user') {
        addMessageToTranscript({
            speaker: 'user',
            text: message.data.text
        });
    } else if (message.data.speaker === 'agent') {
        addMessageToTranscript({
            speaker: 'agent',
            text: message.data.text
        });
    } else if (message.data.role === 'user') {
        addMessageToTranscript({
            speaker: 'user',
            text: message.data.content
        });
    } else if (message.data.role === 'assistant') {
        addMessageToTranscript({
            speaker: 'agent',
            text: message.data.content
        });
    }
}

// Handle action messages from the server
function handleActionMessage(message) {
    console.log('Action message received:', message);
    
    if (!message.actions || !Array.isArray(message.actions) || message.actions.length === 0) {
        console.error('Invalid action message format');
        return;
    }
    
    // Process each action
    message.actions.forEach(action => {
        console.log('Processing action:', action);
        
        // Capture function_call_id if present (sent by server)
        const function_call_id = action.function_call_id;
        const function_name = action.function_name;
        let result = null;
        
        try {
            switch (action.type) {
                case 'add_to_cart':
                    result = handleAddToCartAction(action);
                    break;
                    
                case 'modify_cart_item':
                    result = handleModifyCartItemAction(action);
                    break;
                    
                case 'remove_from_cart':
                    result = handleRemoveFromCartAction(action);
                    break;
                    
                case 'clear_cart':
                    result = handleClearCartAction();
                    break;
                    
                case 'checkout':
                    result = handleCheckoutAction(action);
                    break;
                
                case 'update_customer_phone_number':
                    result = handleCustomerPhone(action);
                    break;
                
                case 'update_customer_address':
                    result = handleCustomerAddress(action);
                    break;

                case 'update_customer_name':
                    result = handleCustomerName(action);
                    break;
                    
                default:
                    console.warn('Unknown action type:', action.type);
            }
            
            // Send response back to server if function_call_id is present
            if (function_call_id) {
                sendActionResponse(function_call_id, result || { success: true }, function_name);
            }
        } catch (error) {
            console.error('Error processing action:', error);
            
            // Send error response if function_call_id is present
            if (function_call_id) {
                sendActionResponse(function_call_id, { 
                    success: false, 
                    error: error.message || 'Unknown error' 
                }, function_name);
            }
        }
    });
}

// Handle error messages
function handleErrorMessage(message) {
    console.error('Server error:', message.message);
    updateStatus(`Error: ${message.message}`);
    
    addMessageToTranscript({
        speaker: 'agent',
        text: `I'm sorry, there was an error processing your request. Please try again.`
    });
}

// Send action response back to the server
function sendActionResponse(function_call_id, output, functionName) {
    if (!webSocket || webSocket.readyState !== WebSocket.OPEN) {
        console.error('WebSocket not connected, cannot send action response');
        return;
    }
    
    try {
        processingFunction = true;
        
        const response = {
            type: 'action_response',
            function_call_id: function_call_id,
            function_name: functionName,
            output: output
        };
        
        console.log('Sending action response:', response);
        webSocket.send(JSON.stringify(response));
        
        // Add a short delay and then ensure listening is active
        setTimeout(() => {
            processingFunction = false;
            ensureListeningActive();
        }, 500);
    } catch (error) {
        console.error('Error sending action response:', error);
        processingFunction = false;
    }
}

// Make sure we're still listening after processing a function
function ensureListeningActive() {
    if (!processingFunction && isConversationActive && !microphoneStream) {
        console.log('Restarting listening...');
        startRecording();
    }
}