const express = require('express');
     const pdfjsLib = require('pdfjs-dist');
     const Tesseract = require('tesseract.js');
     const cors = require('cors');

     const app = express();
     app.use((err, req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.status(500).json({ error: `Internal server error: ${err.message}` });
});
     app.use(express.json({ limit: '50mb' }));

     async function processPage(page, scale, pageNum) {
       try {
         console.log(`[Backend] Rendering page ${pageNum} with scale ${scale}`);
         const viewport = page.getViewport({ scale });
         const canvas = require('canvas').createCanvas(viewport.width, viewport.height);
         const context = canvas.getContext('2d');

         await page.render({
           canvasContext: context,
           viewport
         }).promise;

         console.log(`[Backend] Converting page ${pageNum} to base64`);
         const imgData = canvas.toDataURL('image/jpeg', 0.7);

         console.log(`[Backend] Starting OCR for page ${pageNum}`);
         const result = await Tesseract.recognize(imgData, 'eng', {
           logger: m => console.log(`[Backend] Tesseract progress for page ${pageNum}:`, m)
         });

         const words = result.data.words.map(word => ({
           text: word.text,
           bbox: word.bbox,
           confidence: word.confidence
         }));

         console.log(`[Backend] Extracted ${words.length} words for page ${pageNum}`);
         return { image: imgData, words, pageNum };
       } catch (error) {
         console.error(`[Backend] Error processing page ${pageNum}:`, error.message);
         return { image: '', words: [], error: `Failed to process page ${pageNum}: ${error.message}` };
       }
     }

     app.post('/process-pdf', async (req, res) => {
       try {
         console.log("[Backend] Inside /process-pdf endpoint");
         if (!req.body.pdf) {
           console.error("[Backend] No PDF data provided in request");
           return res.status(400).json({ error: 'No PDF data provided' });
         }

         console.log("[Backend] Decoding base64 PDF data");
         let pdfBuffer;
         try {
           pdfBuffer = Buffer.from(req.body.pdf, 'base64');
           console.log("[Backend] PDF buffer created, size:", pdfBuffer.length);
         } catch (error) {
           console.error("[Backend] Failed to decode base64:", error.message);
           return res.status(400).json({ error: 'Invalid base64 PDF data' });
         }

         console.log("[Backend] Loading PDF with pdfjs-dist");
         let pdf;
         try {
           pdf = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
           console.log("[Backend] PDF loaded, number of pages:", pdf.numPages);
         } catch (error) {
           console.error("[Backend] Failed to load PDF:", error.message);
           return res.status(500).json({ error: 'Failed to load PDF document' });
         }

         const results = [];
         const scale = 1.5;

         for (let i = 1; i <= pdf.numPages; i++) {
           console.log(`[Backend] Processing page ${i}`);
           let page;
           try {
             page = await pdf.getPage(i);
           } catch (error) {
             console.error(`[Backend] Failed to load page ${i}:`, error.message);
             results.push({ image: '', words: [], error: `Failed to load page ${i}` });
             continue;
           }

           const pageResult = await processPage(page, scale, i);
           if (pageResult.error) {
             results.push(pageResult);
             continue;
           }

           const wordsWithTranslations = pageResult.words.map(word => ({
             text: word.text,
             bbox: word.bbox,
             confidence: word.confidence
           }));

           console.log(`[Backend] Words for page ${i}:`, wordsWithTranslations.length);

           results.push({
             image: pageResult.image,
             words: wordsWithTranslations
           });
         }

         console.log("[Backend] Sending results to frontend, pages:", results.length);
         res.json({ pages: results });
       } catch (error) {
         console.error("[Backend] Error in /process-pdf:", error.message, error.stack);
         res.status(500).json({ error: `Internal server error: ${error.message}` });
       }
     });

     const port = process.env.PORT || 3000;
     app.listen(port, () => {
       console.log(`[Backend] Server running on port ${port}`);
     });