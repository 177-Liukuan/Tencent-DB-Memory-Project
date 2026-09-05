# Docling pipeline decision matrix

- Use `standard` for born-digital, text-heavy documents when speed matters.
- Use `vlm` for scanned pages, handwriting, formulas, or complex multi-column layouts.
- Enable table extraction when tables are expected.
- For text-heavy pages with difficult figures, consider hybrid backend text plus VLM images.
- Evaluate the structured JSON result before accepting a high-fidelity conversion.
