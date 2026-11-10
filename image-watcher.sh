#!/bin/bash

# Configuration
WATCH_DIR="/var/www/gDrive/images"
SCRIPT_PATH="/var/www/gDrive/processed/clean-images.sh"
LOG="/var/log/gdrive-sync.log"

echo "$(date): Watcher started. Watching $WATCH_DIR for new JPG/JPEG/PNG files..."

# Listen for new files or files moved into the folder
inotifywait -m -r \
    -e close_write \
    -e moved_to \
    "$WATCH_DIR" \
    --format '%w%f' | while read -r NEW_FILE
do
    # ✅ Fix 2: Only process JPG/JPEG/PNG files — ignore everything else
    if [[ "$NEW_FILE" =~ \.(jpg|jpeg|png|JPG|JPEG|PNG)$ ]]; then

        # Small delay to ensure file is fully written/transferred
        sleep 2

        echo "$(date): New image detected: $NEW_FILE - Running cleanup..."  | tee -a "$LOG"

        # ✅ Fix 1: Pass the exact filename to clean-images.sh
        /bin/bash "$SCRIPT_PATH" "$NEW_FILE" >> "$LOG" 2>&1

    else
        # Silently ignore non-image files
        echo "$(date): Ignored: $NEW_FILE (not a JPG/JPEG/PNG)" >> "$LOG"
    fi
done
