# Fix accept production promotion detection

Accept now determines whether a thread is being accepted into production by reading the process-manager status report and comparing the target parent branch to the configured production branch. This removes reliance on the local caller's `NODE_ENV`, which was incorrect for terminal-driven accepts and could select the local quick-merge flow when the target should be promoted with the blue/green production deployment path.

Both web and CLI accepts now use the same shared production-target detection in `lib/threads.ts`, so accepting a thread whose parent is the current production branch runs the proper production promotion flow.
