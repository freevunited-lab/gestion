FREEV bundles the following local OCR assets for the optional mobile receipt scanner:

- Tesseract.js 6.0.1
- Tesseract.js-core 6.0.0
- French language data `@tesseract.js-data/fra` 1.0.0 (4.0.0 traineddata)

Tesseract.js and Tesseract.js-core are distributed under Apache License 2.0. The full license texts are kept beside these files. The scanner initializes these assets only when a user chooses to read a receipt. Receipt photos and OCR results stay in the browser; the app only prepares an editable draft for its existing transaction form.
