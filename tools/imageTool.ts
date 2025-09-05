import { GoogleGenAI } from '@google/genai';
import { writeFile } from 'fs/promises';
import mime from 'mime';

// This function generates an image using the specified Gemini image generation model.
export async function generateImage(prompt: string): Promise<{ fileUri?: string; text?: string }> {
  console.log(`Generating image for prompt: "${prompt}"`);
  try {
    const ai = new GoogleGenAI(process.env.GEMINI_API_KEY!);
    // As requested, using the model name from the user's context.
    const modelName = 'gemini-2.0-flash-preview-image-generation';
    const model = ai.getGenerativeModel({ model: modelName });

    const contents = [{
        role: 'user',
        parts: [{ text: prompt }]
    }];

    // Using generateContentStream as specified in the user's code snippets.
    const response = await model.generateContentStream({ contents });

    for await (const chunk of response.stream) {
      const part = chunk.candidates?.[0]?.content?.parts?.[0];
      if (part?.inlineData) {
        const { inlineData } = part;
        const fileExtension = mime.getExtension(inlineData.mimeType || 'image/jpeg');
        const fileName = `image-${Date.now()}.${fileExtension}`;
        const filePath = `public/${fileName}`;
        const buffer = Buffer.from(inlineData.data || '', 'base64');

        await writeFile(filePath, buffer);

        console.log(`Image saved to ${filePath}`);
        // Return a URI that the frontend can use to display the image.
        return { fileUri: `/${fileName}` };
      }
    }

    // If the stream finishes without returning image data.
    const finalResponse = await response.response;
    const fallbackText = finalResponse.text();
    console.log('Image generation finished with text response:', fallbackText);
    return { text: fallbackText || "Could not generate an image from the response." };

  } catch (error) {
    console.error('Error generating image:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { text: `An error occurred while generating the image: ${errorMessage}` };
  }
}
