# Fix ChatGPT logo background

The ChatGPT/OpenAI brand icon had been represented by raster PNG assets with an opaque or overly padded background, which looked wrong on Primordia's dark UI.

The app now uses ChatGPT's SVG favicon asset for ChatGPT/OpenAI billing and model icons. This removes the white square, avoids raster scaling artifacts, and gives the mark tighter spacing in small icon slots.

The model picker also uses the ChatGPT/OpenAI icon for ChatGPT subscription (`openai-codex`) model groups instead of the Codex favicon, so the UI matches the billing/model source being shown.
