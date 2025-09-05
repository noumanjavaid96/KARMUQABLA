import {
  GoogleGenAI,
  LiveServerMessage,
  MediaResolution,
  Modality,
  Session,
  Tool,
  FunctionDeclaration,
  FunctionCall,
} from '@google/genai';
import { WebSocket } from 'ws';
import { generateImage } from './tools/imageTool';

// Define the schema for the image generation tool, as specified in user context.
const imageGenerationTool: FunctionDeclaration = {
  name: 'generateImage',
  description: 'Generates an image based on a textual prompt and saves it to a file.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The descriptive prompt for creating the image.',
      },
    },
    required: ['prompt'],
  },
};

// This class manages the state and logic for a single live session.
class SessionManager {
  private responseQueue: LiveServerMessage[] = [];
  private session: Session | undefined = undefined;
  private ws: WebSocket;
  private turnInProgress = false;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  // Main entry point to start the session and send a prompt.
  public async start(prompt: string) {
    try {
      const ai = new GoogleGenAI(process.env.GEMINI_API_KEY!);
      const model = 'models/gemini-2.5-flash-live-preview'; // As specified by user.

      const tools: Tool[] = [{
        functionDeclarations: [imageGenerationTool],
      }];

      const config = {
        responseModalities: [Modality.AUDIO, Modality.TEXT],
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        speechConfig: {
          languageCode: 'en-US',
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Puck' },
          },
        },
        tools,
      };

      this.session = await ai.live.connect({
        model,
        config,
        callbacks: {
          onopen: () => console.debug('Session opened.'),
          onmessage: (message: LiveServerMessage) => this.responseQueue.push(message),
          onerror: (e: ErrorEvent) => this.handleError(e),
          onclose: (e: CloseEvent) => this.handleClose(e),
        },
      });

      this.session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      // Start processing the response turns from the model.
      await this.handleTurn();

    } catch (error) {
      console.error('Error starting live session:', error);
      this.ws.send(JSON.stringify({ type: 'error', data: 'Failed to start session.' }));
    }
  }

  // Processes all messages for a single turn until the model indicates it's complete.
  private async handleTurn() {
    this.turnInProgress = true;
    while (this.turnInProgress) {
      const message = await this.waitMessage();
      if (message) {
        await this.handleModelMessage(message);
        if (message.serverContent?.turnComplete) {
          this.turnInProgress = false;
        }
      } else {
        // If waitMessage returns undefined, the queue might be empty and the session closed.
        this.turnInProgress = false;
      }
    }
    console.log('Turn complete.');
    this.session?.close();
  }

  // Waits for a message to appear in the queue, with a short delay between checks.
  private async waitMessage(): Promise<LiveServerMessage | undefined> {
    while (this.responseQueue.length === 0) {
      if (!this.session || this.session.isClosed()) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this.responseQueue.shift();
  }

  // Handles the content of a single message from the model, dispatching to appropriate handlers.
  private async handleModelMessage(message: LiveServerMessage) {
    if (message.serverContent?.modelTurn?.parts) {
      for (const part of message.serverContent.modelTurn.parts) {
        if (part.text) {
          this.ws.send(JSON.stringify({ type: 'text', data: part.text }));
        }
        if (part.inlineData?.data) {
          // Stream audio data directly to the client for real-time playback.
          this.ws.send(JSON.stringify({ type: 'audio', data: part.inlineData.data }));
        }
      }
    }

    if (message.toolCall?.functionCalls) {
        await this.handleToolCall(message.toolCall.functionCalls);
    }
  }

  // Handles a tool call from the model.
  private async handleToolCall(functionCalls: FunctionCall[]) {
    const responses = [];
    for (const call of functionCalls) {
      if (call.name === 'generateImage' && call.args?.prompt) {
        console.log(`Executing tool: ${call.name}`, call.args);
        const { fileUri, text } = await generateImage(call.args.prompt as string);

        if (fileUri) {
          this.ws.send(JSON.stringify({ type: 'image', data: fileUri }));
        }

        responses.push({
          id: call.id,
          name: call.name,
          response: { response: fileUri ? `Image generated at ${fileUri}` : text || 'Tool executed.' },
        });
      }
    }
    this.session?.sendToolResponse({ functionResponses: responses });
  }

  private handleError(e: ErrorEvent) {
    console.debug('Session Error:', e.message);
    this.ws.send(JSON.stringify({ type: 'error', data: e.message }));
    this.turnInProgress = false;
  }

  private handleClose(e: CloseEvent) {
    console.debug('Session Close:', e.reason);
    this.ws.send(JSON.stringify({ type: 'status', data: 'done' }));
    this.turnInProgress = false;
  }
}

// The main exported function that the server will call to start a new session.
export async function runLiveSession(prompt: string, ws: WebSocket) {
  const manager = new SessionManager(ws);
  await manager.start(prompt);
}
