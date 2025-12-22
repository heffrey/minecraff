# Minecraff - 8-bit Adventure Game

A fun 2D browser-based adventure game featuring Alex and Steve, inspired by classic 8-bit games. Chop down trees, collect resources, and explore the world!

<img width="844" height="623" alt="image" src="https://github.com/user-attachments/assets/53ec0348-1967-49cc-b8fa-369e9bb1c839" />

<img width="847" height="630" alt="image" src="https://github.com/user-attachments/assets/7252f187-13c3-4c62-a1c3-e98da3ca42d0" />


## Features

- **Two Playable Characters**: Control Alex and Steve with different controls
- **Tree Chopping**: Chop down trees to collect wood resources
- **Particle Effects**: Beautiful wood sprite explosion animations when trees are chopped
- **Inventory System**: Track collected resources (wood, dirt, stone, clay, gold, iron, silver)
- **Sprite Editor**: Built-in sprite editor for customizing character and object sprites
- **Physics System**: Realistic gravity, collision detection, and character movement
- **Debug Mode**: Visualize bounding boxes and interaction ranges

## Controls

### Steve (Character 1)
- **Arrow Left/Right**: Move left/right
- **Arrow Up / Space**: Jump
- **E**: Chop nearby trees (hold to continuously chop)

### Alex (Character 2)
- **A/D**: Move left/right
- **W**: Jump
- **E**: Chop nearby trees (hold to continuously chop)

### General
- **I**: Toggle inventory display
- **D**: Toggle debug mode (show bounding boxes)

## Getting Started

### Prerequisites

- A modern web browser (Chrome, Firefox, Safari, Edge)
- A local web server (for best results, especially for sprite analysis)

### Installation

1. Clone the repository:
```bash
git clone git@github.com:heffrey/minecraff.git
cd minecraff
```

2. Start a local web server (recommended):
```bash
# Using Python 3
python3 -m http.server 8000

# Using Python 2
python -m SimpleHTTPServer 8000

# Using Node.js (if you have http-server installed)
npx http-server
```

3. Open your browser and navigate to:
```
http://localhost:8000
```

**Note**: While you can open `index.html` directly in your browser, using a local web server is recommended for:
- Proper CORS handling for sprite sheet analysis
- Better alpha channel detection for sprite bounding boxes
- Improved performance

## Gameplay

1. **Movement**: Use the arrow keys (Steve) or WASD (Alex) to move around
2. **Tree Chopping**: 
   - Approach a tree
   - Press and hold 'E' to start chopping
   - After 3 hits, the tree will fall and wood particles will explode outward
   - Wood is automatically added to your inventory
3. **Inventory**: Press 'I' to view your collected resources

## Project Structure

```
minecraff/
├── index.html              # Main game HTML file
├── game.js                 # Core game logic and engine
├── style.css               # Game styling
├── sprite-editor.html      # Sprite editor interface
├── sprite-editor.js        # Sprite editor logic
├── sprite-editor.css       # Sprite editor styling
├── inventory-sprite-config.json  # Inventory sprite mappings
├── steve.png               # Steve character sprite sheet
├── alex.png                # Alex character sprite sheet
├── trees.png               # Trees and shrubs sprite sheet
├── inventory.png           # Inventory item sprite sheet
└── README.md               # This file
```

## Sprite Editor

The game includes a built-in sprite editor (`sprite-editor.html`) that allows you to:
- Load and view sprite sheets
- Configure frame dimensions
- Map frames to animations and objects
- Export configuration as JSON
- Analyze sprite bounding boxes

To use the sprite editor:
1. Open `sprite-editor.html` in your browser
2. Load a sprite sheet image
3. Configure frame dimensions (width, height, columns, rows)
4. Select frames and assign them to animations or objects
5. Export the configuration to use in the game

## Technical Details

### Sprite Sheets
- **Characters**: 256x256 pixel frames, 4x4 grid (16 frames total)
- **Trees**: 194x260 pixel frames, 5x4 grid (20 frames total)
- **Inventory**: 164x228 pixel frames, 6x1 grid (6 frames total)

### Game Engine Features
- Canvas-based rendering
- Frame-based animation system
- Alpha channel analysis for accurate collision detection
- Physics simulation (gravity, velocity, collision)
- Particle system for visual effects
- Inventory management system

### Performance
- Optimized sprite rendering with frame caching
- Efficient collision detection using bounding boxes
- Particle cleanup to prevent memory leaks

## Development

### Adding New Features

1. **New Characters**: Add sprite sheets and configure in `game.js` character configs
2. **New Items**: Add to inventory sprite sheet and update `inventory-sprite-config.json`
3. **New Objects**: Add to trees sprite sheet or create new sprite sheets

### Debugging

Enable debug mode by pressing 'D' to visualize:
- Character bounding boxes
- Tree bounding boxes
- Interaction ranges
- Frame indices

## Browser Compatibility

- ✅ Chrome/Edge (latest)
- ✅ Firefox (latest)
- ✅ Safari (latest)
- ⚠️ Older browsers may have limited support for canvas features

## License

This project is open source and available for personal and educational use.

## Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest new features
- Submit pull requests
- Improve documentation

## Credits

- Game engine and mechanics: Custom implementation
- Sprite sheets: Custom assets
- Inspiration: Classic 8-bit adventure games

## Future Enhancements

- [ ] More resource types and crafting system
- [ ] Building mechanics
- [ ] More character animations
- [ ] Sound effects and music
- [ ] Save/load game state
- [ ] Multiplayer support
- [ ] More biomes and environments

---

Enjoy playing Minecraff! 🎮

