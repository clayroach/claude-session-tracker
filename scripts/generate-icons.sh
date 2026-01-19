#!/bin/bash
# Generate macOS .icns icon from SVG

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESOURCES_DIR="$PROJECT_DIR/resources"
SVG_FILE="$RESOURCES_DIR/icon.svg"
ICONSET_DIR="$RESOURCES_DIR/icon.iconset"

# Check for required tools
if ! command -v rsvg-convert &> /dev/null; then
    echo "rsvg-convert not found. Installing via brew..."
    brew install librsvg
fi

# Create iconset directory
mkdir -p "$ICONSET_DIR"

# Generate PNG at various sizes
# macOS requires specific sizes for the iconset
sizes=(16 32 64 128 256 512 1024)
for size in "${sizes[@]}"; do
    echo "Generating ${size}x${size}..."
    rsvg-convert -w $size -h $size "$SVG_FILE" -o "$ICONSET_DIR/icon_${size}x${size}.png"

    # Also generate @2x versions for Retina
    if [ $size -le 512 ]; then
        double=$((size * 2))
        rsvg-convert -w $double -h $double "$SVG_FILE" -o "$ICONSET_DIR/icon_${size}x${size}@2x.png"
    fi
done

# Convert iconset to icns
echo "Creating icon.icns..."
iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/icon.icns"

# Clean up iconset directory
rm -rf "$ICONSET_DIR"

echo "Done! Icon created at $RESOURCES_DIR/icon.icns"
