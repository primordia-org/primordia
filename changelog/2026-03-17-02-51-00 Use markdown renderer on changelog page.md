The changelog page previously rendered entry content as raw preformatted text (`<pre>`). It now renders it with the existing markdown renderer so bold text, inline code, links, and bullet lists are properly formatted.

**What changed**:
- `components/SimpleMarkdown.tsx` (new): extracted `SimpleMarkdown` (inline renderer) from `ChatInterface.tsx` into a shared module. Added `MarkdownContent` (block renderer) that splits multi-line markdown into paragraphs and bullet lists, rendering each line with `SimpleMarkdown` for inline formatting.
- `components/ChatInterface.tsx`: removed the inline `SimpleMarkdown` function definition and imports it from `./SimpleMarkdown` instead.
- `app/changelog/page.tsx`: replaced `<pre>` with `<MarkdownContent>` for entry bodies, so changelog content is rendered with proper markdown formatting.

**Why**: Changelog entries are written in markdown (bold labels like `**What changed**:`, inline code like `` `file.tsx` ``, bullet lists) and were being displayed as raw text. Using the existing renderer improves readability without adding any new dependencies.
