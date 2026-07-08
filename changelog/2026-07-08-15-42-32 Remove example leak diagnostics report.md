# Remove example leak diagnostics report

Removed the checked-in sample CPU/memory leak diagnostics files that were originally used to preview the Server Health diagnostics UI. Because those files shipped with every deploy, fresh deployments incorrectly showed an "example report for UI testing" under “Diagnose CPU usage / memory leaks.”

Added `leak-diagnostics/` to `.gitignore` so real runtime diagnostics can still be generated locally on affected instances without being committed as bundled example data again.
