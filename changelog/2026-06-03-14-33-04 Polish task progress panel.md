# Polish task progress panel

Updated the evolve session task progress panel to use the simpler title “Tasks,” show “completed” once all visible tasks are done, and remove the bordered card treatment from individual task rows.

Task rows now avoid their own border, background fill, rounded container, and extra padding so the list reads as a lighter inline checklist while preserving status icons and readability.

Added a shared stylized `ProgressBar` component and extended the task panel with a simple “Progress” section below the task list. The section shows weighted completion progress as a gradient bar and lists the currently active in-progress task titles underneath it when any are active. The bar no longer displays a percentage, completion text now reads “x of n” on the Progress title row, and its gradient is clipped against a fixed full-track gradient so the color at the right edge reflects the current progress instead of rescaling with the filled width.
