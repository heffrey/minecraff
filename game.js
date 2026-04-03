// Game Canvas Setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const loadingEl = document.getElementById('loading');

// Game State
const game = {
    characters: [],
    keys: {},
    spriteSheets: {},
    trees: [],
    chickens: [], // Chickens in the world
    mobs: [], // Mobs in the world (zombies, skeletons, creepers, spiders, slimes, pigs)
    particles: [], // Particle effects (e.g., wood sprites exploding from trees)
    treeSpawnPoints: [], // Original tree spawn positions for regrowth
    treeRegrowthQueue: [], // Trees waiting to regrow {x, frameIndex, regrowAt}
    placedTiles: [], // Tiles placed in the world (world coordinates)
    spawnedTreeChunks: new Set(), // Track which chunks have already spawned trees
    camera: {
        x: 0, // Camera position in world coordinates
        y: 0
    },
    inventory: {
        wood: 0,
        dirt: 0,
        stone: 0,
        clay: 0,
        gold: 0,
        iron: 0,
        silver: 0,
        sand: 0,
        snow: 0,
        items: []
    },
    inventoryMappings: null, // Frame mappings for inventory items (from config)
    treesMappings: null, // Frame mappings for trees (from config)
    shrubsMappings: null, // Frame mappings for shrubs (from config)
    materialsMappings: null, // Frame mappings for materials (tile placement)
    showInventory: false, // Press 'I' to toggle inventory display
    showMaterialPalette: false, // Press 'P' to toggle material palette
    selectedMaterial: null, // Currently selected material for placement
    placementMode: false, // Whether placement mode is active
    debugMode: false, // Press 'B' to toggle debug mode (show bounding boxes)
    scrollingMode: false, // Whether world scrolling is active (hold Shift)
    mining: {
        isMining: false,
        targetTreeIndex: -1,
        lastHitTime: 0,
        hitInterval: 500 // Milliseconds between hits
    },
    dayNight: {
        phase: 'DAY',          // 'DAY' | 'EVENING' | 'NIGHT' | 'DAWN'
        elapsed: 0,            // ms elapsed in current cycle
        cycleDuration: 600000, // 10 minutes
        lastTimestamp: null    // for delta time
    },
    prevBiome: null            // tracks biome changes for cave spider spawning
};

// Sprite Sheet Loader
class SpriteSheet {
    constructor(image, frameWidth, frameHeight, cols, rows) {
        this.image = image;
        this.frameWidth = frameWidth;
        this.frameHeight = frameHeight;
        this.cols = cols;
        this.rows = rows;
        this.totalFrames = cols * rows;
        this.frameBounds = {}; // Cache for frame bounding boxes
        this.alphaThreshold = 10; // Alpha value threshold (0-255) for considering a pixel "dark"
    }

    // Analyze a frame to find the bounding box of non-transparent pixels
    async analyzeFrameAlpha(frameIndex) {
        if (this.frameBounds[frameIndex]) {
            return this.frameBounds[frameIndex];
        }

        const col = frameIndex % this.cols;
        const row = Math.floor(frameIndex / this.cols);
        
        const sx = col * this.frameWidth;
        const sy = row * this.frameHeight;

        // Create a temporary canvas to extract frame data
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.frameWidth;
        tempCanvas.height = this.frameHeight;
        const tempCtx = tempCanvas.getContext('2d');
        
        // Draw the frame to the temp canvas
        tempCtx.drawImage(
            this.image,
            sx, sy, this.frameWidth, this.frameHeight,
            0, 0, this.frameWidth, this.frameHeight
        );

        // Get image data - handle CORS errors for local files
        let imageData;
        let data;
        try {
            imageData = tempCtx.getImageData(0, 0, this.frameWidth, this.frameHeight);
            data = imageData.data;
        } catch (error) {
            // CORS error - can't read pixel data from local files
            // Use full frame bounds as fallback
            console.warn(`Cannot analyze alpha channel for frame ${frameIndex} (CORS restriction). Using full frame bounds.`);
            const bounds = {
                x: 0,
                y: 0,
                width: this.frameWidth,
                height: this.frameHeight,
                offsetX: 0,
                offsetY: 0
            };
            this.frameBounds[frameIndex] = bounds;
            return bounds;
        }

        // Find bounding box of non-transparent pixels
        let minX = this.frameWidth;
        let minY = this.frameHeight;
        let maxX = 0;
        let maxY = 0;
        let foundPixel = false;

        // Scan for non-transparent pixels
        for (let y = 0; y < this.frameHeight; y++) {
            for (let x = 0; x < this.frameWidth; x++) {
                const idx = (y * this.frameWidth + x) * 4;
                const alpha = data[idx + 3]; // Alpha channel
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                
                // Check if pixel is non-transparent and "dark enough"
                // A pixel is considered valid if alpha > threshold
                // Optionally, you can also check if it's "dark" (low brightness)
                const brightness = (r + g + b) / 3;
                const isDark = brightness < 200; // Adjust threshold as needed
                
                if (alpha > this.alphaThreshold) {
                    foundPixel = true;
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }
        }

        // If no pixels found, use full frame
        if (!foundPixel) {
            minX = 0;
            minY = 0;
            maxX = this.frameWidth;
            maxY = this.frameHeight;
        }

        // Store bounding box (relative to frame origin)
        const bounds = {
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
            offsetX: minX, // Offset from left edge of frame
            offsetY: minY   // Offset from top edge of frame
        };

        this.frameBounds[frameIndex] = bounds;
        return bounds;
    }

    // Get bounding box for a frame (async, but cached after first call)
    async getFrameBounds(frameIndex) {
        return await this.analyzeFrameAlpha(frameIndex);
    }

    // Pre-analyze all frames (call this after image loads)
    async analyzeAllFrames() {
        const promises = [];
        for (let i = 0; i < this.totalFrames; i++) {
            promises.push(this.analyzeFrameAlpha(i).catch(err => {
                console.warn(`Failed to analyze frame ${i}:`, err);
                // Return full frame bounds as fallback
                return {
                    x: 0,
                    y: 0,
                    width: this.frameWidth,
                    height: this.frameHeight,
                    offsetX: 0,
                    offsetY: 0
                };
            }));
        }
        await Promise.all(promises);
        console.log(`Analyzed ${this.totalFrames} frames for ${this.image.src}`);
    }

    drawFrame(ctx, frameIndex, x, y, scale = 1) {
        const col = frameIndex % this.cols;
        const row = Math.floor(frameIndex / this.cols);
        
        const sx = col * this.frameWidth;
        const sy = row * this.frameHeight;
        
        ctx.drawImage(
            this.image,
            sx, sy, this.frameWidth, this.frameHeight,
            x, y, this.frameWidth * scale, this.frameHeight * scale
        );
    }
}

// Character Class
class Character {
    constructor(name, spriteSheet, x, y, config = {}) {
        this.name = name;
        this.spriteSheet = spriteSheet;
        this.x = x;
        this.y = y;
        
        // Scale based on frame size - larger frames need smaller scale
        // For 256x256 frames, use 0.3-0.4 scale to keep characters reasonable size
        // For 32x32 frames, use 3-4 scale
        const baseScale = spriteSheet.frameWidth > 100 ? 0.3 : 3;
        this.scale = config.scale || baseScale;
        
        this.width = spriteSheet.frameWidth * this.scale;
        this.height = spriteSheet.frameHeight * this.scale;
        
        // Animation
        this.currentFrame = 0;
        this.frameCounter = 0;
        this.animationSpeed = config.animationSpeed || 8; // frames per animation frame
        
        // State
        this.state = 'idle'; // idle, walk, jump, mine
        this.facing = 'right'; // left, right
        this.velocityX = 0;
        this.velocityY = 0;
        this.speed = 2;
        this.jumpPower = -8;
        this.gravity = 0.5;
        this.onGround = false;
        
        // Animation frames mapping - use config or defaults
        this.animations = config.animations || {
            idle: [0],
            walk: [1],
            jump: [10],
            mine: [8, 9]
        };
        
        // Debug: show bounding boxes
        this.showBounds = config.showBounds || false;
        
        // Cache for current bounds (updated in update method)
        this.currentBounds = null;
    }
    
    // Get the Y position where the character's feet (bottom of sprite content) should be
    // This accounts for transparent padding at the bottom of the sprite frame
    getFeetYPosition(groundY) {
        const animFrames = this.animations[this.state] || this.animations.idle;
        const frameIndex = animFrames[this.currentFrame] || animFrames[0] || 0;
        const frameBounds = this.spriteSheet.frameBounds[frameIndex];
        
        // If bounds not yet analyzed, use full frame (fallback)
        // This might happen if frame analysis hasn't completed yet
        if (!frameBounds) {
            // Try to use the first available frame bounds as an approximation
            const firstFrameBounds = Object.values(this.spriteSheet.frameBounds)[0];
            if (firstFrameBounds) {
                const spriteBottomInFrame = firstFrameBounds.offsetY + firstFrameBounds.height;
                const result = groundY - (spriteBottomInFrame * this.scale);
                return result;
            }
            // Last resort: use full frame height (but this will likely be wrong)
            return groundY - this.height;
        }
        
        // Calculate where the bottom of the actual sprite content is within the frame
        // frameBounds.offsetY is the top offset, frameBounds.height is the content height
        // So the bottom of content in frame coordinates is: offsetY + height
        const spriteBottomInFrame = frameBounds.offsetY + frameBounds.height;
        const calculatedY = groundY - (spriteBottomInFrame * this.scale);
        
        // Convert to world coordinates and calculate Y position
        // We want: y + (spriteBottomInFrame * scale) = groundY
        // So: y = groundY - (spriteBottomInFrame * scale)
        return calculatedY;
    }
    
    // Get current frame's bounding box in world coordinates (synchronous, uses cached frame bounds)
    getCurrentBounds(cameraX = 0, cameraY = 0) {
        const animFrames = this.animations[this.state] || this.animations.idle;
        const frameIndex = animFrames[this.currentFrame] || 0;
        const frameBounds = this.spriteSheet.frameBounds[frameIndex];
        
        // If bounds not yet analyzed, return full frame bounds
        if (!frameBounds) {
            return {
                x: this.x - cameraX, // Screen X
                y: this.y - cameraY, // Screen Y
                width: this.width,
                height: this.height
            };
        }
        
        // Convert frame-relative bounds to world coordinates, then to screen coordinates
        let worldX = this.x + (frameBounds.offsetX * this.scale);
        const worldY = this.y + (frameBounds.offsetY * this.scale);
        
        // Account for horizontal flip
        if (this.facing === 'left') {
            worldX = this.x + this.width - (frameBounds.offsetX + frameBounds.width) * this.scale;
        }
        
        return {
            x: worldX - cameraX, // Screen X
            y: worldY - cameraY, // Screen Y
            width: frameBounds.width * this.scale,
            height: frameBounds.height * this.scale
        };
    }
    
    // Get world bounds (for collision detection)
    getWorldBounds() {
        const animFrames = this.animations[this.state] || this.animations.idle;
        const frameIndex = animFrames[this.currentFrame] || 0;
        const frameBounds = this.spriteSheet.frameBounds[frameIndex];
        
        if (!frameBounds) {
            return {
                x: this.x,
                y: this.y,
                width: this.width,
                height: this.height
            };
        }
        
        let worldX = this.x + (frameBounds.offsetX * this.scale);
        const worldY = this.y + (frameBounds.offsetY * this.scale);
        
        if (this.facing === 'left') {
            worldX = this.x + this.width - (frameBounds.offsetX + frameBounds.width) * this.scale;
        }
        
        return {
            x: worldX,
            y: worldY,
            width: frameBounds.width * this.scale,
            height: frameBounds.height * this.scale
        };
    }

    update() {
        // Apply gravity
        if (!this.onGround) {
            this.velocityY += this.gravity;
        } else {
            this.velocityY = 0;
        }
        
        // Store old position for collision resolution
        const oldX = this.x;
        const oldY = this.y;
        
        // Update position
        this.x += this.velocityX;
        this.y += this.velocityY;
        
        // Check for step-up opportunity (stairs climbing)
        // Only check if moving horizontally and on ground, and NOT already standing on a tile
        // This prevents interference with normal movement across adjacent tiles at the same level
        if (this.velocityX !== 0 && this.onGround) {
            // First check if we're already standing on a tile - if so, skip step-up logic
            // The normal tile standing logic will handle adjacent tiles at the same level
            const charWorldBounds = this.getWorldBounds();
            const charFeetY = charWorldBounds.y + charWorldBounds.height;
            let alreadyOnTile = false;
            
            for (const tile of game.placedTiles) {
                const tileWorldBounds = tile.getWorldBounds();
                const horizontalOverlap = charWorldBounds.x < tileWorldBounds.x + tileWorldBounds.width &&
                                         charWorldBounds.x + charWorldBounds.width > tileWorldBounds.x;
                if (horizontalOverlap) {
                    const tileTopY = tileWorldBounds.y;
                    const tolerance = 8;
                    if (charFeetY >= tileTopY - tolerance && charFeetY <= tileTopY + tolerance) {
                        alreadyOnTile = true;
                        break;
                    }
                }
            }
            
            // Only check for step-up if we're NOT already on a tile
            if (!alreadyOnTile) {
                const stepUpTile = this.getStepUpTile();
                if (stepUpTile) {
                    const tileWorldBounds = stepUpTile.getWorldBounds();
                    const tileTopY = tileWorldBounds.y;
                    const stepHeight = tileTopY - charFeetY;
                    
                    // Only step up if the step is reasonable (one tile height or less)
                    const maxStepHeight = 32 + 5; // Tile height + tolerance
                    if (stepHeight > 0 && stepHeight <= maxStepHeight) {
                        // Step up onto the tile
                        const animFrames = this.animations[this.state] || this.animations.idle;
                        const frameIndex = animFrames[this.currentFrame] || 0;
                        const frameBounds = this.spriteSheet.frameBounds[frameIndex];
                        
                        if (frameBounds) {
                            let adjustedHeight = frameBounds.height;
                            if (this.name === 'Steve' && frameIndex === this.animations.idle[0]) {
                                const alexFrame0Bounds = game.spriteSheets.alex?.frameBounds[0];
                                if (alexFrame0Bounds && frameBounds.height >= 250) {
                                    const estimatedBottomPadding = 30;
                                    adjustedHeight = Math.max(frameBounds.height - estimatedBottomPadding, alexFrame0Bounds.height);
                                }
                            }
                            const spriteBottomInFrame = frameBounds.offsetY + adjustedHeight;
                            this.y = tileTopY - (spriteBottomInFrame * this.scale);
                            this.onGround = true;
                            this.velocityY = 0;
                        }
                    }
                }
            }
        }
        
        // Check horizontal collision with tiles
        const collidingTilesHorizontal = this.getCollidingTilesHorizontal();
        if (collidingTilesHorizontal.length > 0) {
            // Revert X position if colliding horizontally
            this.x = oldX;
            this.velocityX = 0;
        }
        
        // Ground collision - position based on actual sprite bottom (feet)
        const groundY = canvas.height - 50;
        
        // Calculate current feet position (in world coordinates)
        const animFrames = this.animations[this.state] || this.animations.idle;
        const frameIndex = animFrames[this.currentFrame] || 0;
        const frameBounds = this.spriteSheet.frameBounds[frameIndex];
        
        let currentFeetY;
        if (frameBounds) {
            // For Steve, apply the same height adjustment as positioning
            let adjustedHeight = frameBounds.height;
            if (this.name === 'Steve' && frameIndex === this.animations.idle[0]) {
                const alexFrame0Bounds = game.spriteSheets.alex?.frameBounds[0];
                if (alexFrame0Bounds && frameBounds.height >= 250) {
                    const estimatedBottomPadding = 30;
                    adjustedHeight = Math.max(frameBounds.height - estimatedBottomPadding, alexFrame0Bounds.height);
                }
            }
            // Calculate where the bottom of the actual sprite content is
            const spriteBottomInFrame = frameBounds.offsetY + adjustedHeight;
            currentFeetY = this.y + (spriteBottomInFrame * this.scale);
        } else {
            // Fallback: use full frame height
            currentFeetY = this.y + this.height;
        }
        
        // Check if character is standing on a tile
        const tileBelow = this.getTileBelow();
        let standingOnTile = false;
        let tileTopY = null;
        
        if (tileBelow) {
            const tileWorldBounds = tileBelow.getWorldBounds();
            tileTopY = tileWorldBounds.y;
            const charWorldBounds = this.getWorldBounds();
            const charFeetY = charWorldBounds.y + charWorldBounds.height;
            
            // If character's feet are at or below the top of the tile, stand on it
            // Increased tolerance for smoother stair transitions
            if (charFeetY >= tileTopY - 8 && charFeetY <= tileTopY + 8) {
                standingOnTile = true;
                // Position character on top of tile
                const animFrames = this.animations[this.state] || this.animations.idle;
                const frameIndex = animFrames[this.currentFrame] || 0;
                const frameBounds = this.spriteSheet.frameBounds[frameIndex];
                
                if (frameBounds) {
                    let adjustedHeight = frameBounds.height;
                    if (this.name === 'Steve' && frameIndex === this.animations.idle[0]) {
                        const alexFrame0Bounds = game.spriteSheets.alex?.frameBounds[0];
                        if (alexFrame0Bounds && frameBounds.height >= 250) {
                            const estimatedBottomPadding = 30;
                            adjustedHeight = Math.max(frameBounds.height - estimatedBottomPadding, alexFrame0Bounds.height);
                        }
                    }
                    const spriteBottomInFrame = frameBounds.offsetY + adjustedHeight;
                    this.y = tileTopY - (spriteBottomInFrame * this.scale);
                } else {
                    this.y = tileTopY - this.height;
                }
                this.onGround = true;
                this.velocityY = 0;
            }
        }
        
        // Check for step-down opportunity (walking down stairs)
        // If moving horizontally and on a tile, check if we should step down
        if (this.velocityX !== 0 && standingOnTile && tileBelow) {
            const tileWorldBounds = tileBelow.getWorldBounds();
            const charWorldBounds = this.getWorldBounds();
            const charLeftX = charWorldBounds.x;
            const charRightX = charWorldBounds.x + charWorldBounds.width;
            const direction = this.velocityX > 0 ? 1 : -1;
            
            // Check if character is moving off the edge of the current tile
            const movingOffEdge = direction > 0 ? 
                (charRightX > tileWorldBounds.x + tileWorldBounds.width - 5) :
                (charLeftX < tileWorldBounds.x + 5);
            
            if (movingOffEdge) {
                // Look for a lower tile or ground ahead
                const checkAhead = direction > 0 ? charRightX + 10 : charLeftX - 10;
                let foundLowerSurface = false;
                let lowestSurfaceY = null;
                
                // Check ground level (world coordinates - fixed position)
                const worldGroundY = canvas.height - 50; // Fixed world ground Y
                lowestSurfaceY = worldGroundY;
                
                // Check for tiles ahead
                for (const tile of game.placedTiles) {
                    const aheadTileWorldBounds = tile.getWorldBounds();
                    const aheadTileTopY = aheadTileWorldBounds.y;
                    
                    // Check if tile is ahead in movement direction
                    const tileAhead = direction > 0 ?
                        (aheadTileWorldBounds.x >= tileWorldBounds.x + tileWorldBounds.width && 
                         aheadTileWorldBounds.x <= checkAhead) :
                        (aheadTileWorldBounds.x + aheadTileWorldBounds.width <= tileWorldBounds.x &&
                         aheadTileWorldBounds.x + aheadTileWorldBounds.width >= checkAhead);
                    
                    if (!tileAhead) continue;
                    
                    // Check horizontal overlap
                    const horizontalOverlap = charLeftX < aheadTileWorldBounds.x + aheadTileWorldBounds.width &&
                                           charRightX > aheadTileWorldBounds.x;
                    
                    if (horizontalOverlap || tileAhead) {
                        // Found a surface ahead - use it if it's lower
                        if (lowestSurfaceY === null || aheadTileTopY > lowestSurfaceY) {
                            lowestSurfaceY = aheadTileTopY;
                            foundLowerSurface = true;
                        }
                    }
                }
                
                // If we found a lower surface and it's a reasonable step down, allow it
                if (foundLowerSurface && lowestSurfaceY > tileTopY) {
                    const stepDownHeight = lowestSurfaceY - tileTopY;
                    // Allow stepping down if it's reasonable (one tile height or less)
                    if (stepDownHeight <= 40) {
                        // Character will naturally fall/step down - don't force position
                        // The ground collision check will handle it
                        standingOnTile = false;
                    }
                }
            }
        }
        
        // If not standing on a tile, check ground collision (world coordinates)
        // Skip ground collision check if jumping upward (velocityY < 0) to prevent resetting onGround immediately after jump
        if (!standingOnTile && !(this.state === 'jump' && this.velocityY < 0)) {
            const worldGroundY = canvas.height - 50; // Fixed world ground Y position
            if (currentFeetY >= worldGroundY) {
                const oldY = this.y;
                // For Steve, use the same adjusted calculation as initial positioning
                if (this.name === 'Steve') {
                    const steveIdleFrame = this.animations.idle[0];
                    const steveFrameBounds = this.spriteSheet.frameBounds[steveIdleFrame];
                    if (steveFrameBounds) {
                        // Apply same adjustment as initial positioning
                        const alexFrame0Bounds = game.spriteSheets.alex?.frameBounds[0];
                        let adjustedHeight = steveFrameBounds.height;
                        if (alexFrame0Bounds && steveFrameBounds.height >= 250) {
                            const estimatedBottomPadding = 30;
                            adjustedHeight = Math.max(steveFrameBounds.height - estimatedBottomPadding, alexFrame0Bounds.height);
                        }
                        const steveSpriteBottom = steveFrameBounds.offsetY + adjustedHeight;
                        this.y = worldGroundY - (steveSpriteBottom * this.scale);
                    } else {
                        this.y = this.getFeetYPosition(worldGroundY);
                    }
                } else {
                    this.y = this.getFeetYPosition(worldGroundY);
                }
                this.onGround = true;
                this.velocityY = 0;
            } else {
                this.onGround = false;
            }
        }
        
        // Check vertical collision with tiles (falling into a tile from above)
        if (!standingOnTile && this.velocityY > 0) {
            const charWorldBounds = this.getWorldBounds();
            const charFeetY = charWorldBounds.y + charWorldBounds.height;
            
            for (const tile of game.placedTiles) {
                const tileWorldBounds = tile.getWorldBounds();
                // Check if character is above the tile and would collide
                if (charWorldBounds.x < tileWorldBounds.x + tileWorldBounds.width &&
                    charWorldBounds.x + charWorldBounds.width > tileWorldBounds.x &&
                    charFeetY > tileWorldBounds.y &&
                    charFeetY < tileWorldBounds.y + tileWorldBounds.height) {
                    // Character is falling into a tile - stop at the top of the tile
                    const animFrames = this.animations[this.state] || this.animations.idle;
                    const frameIndex = animFrames[this.currentFrame] || 0;
                    const frameBounds = this.spriteSheet.frameBounds[frameIndex];
                    
                    if (frameBounds) {
                        let adjustedHeight = frameBounds.height;
                        if (this.name === 'Steve' && frameIndex === this.animations.idle[0]) {
                            const alexFrame0Bounds = game.spriteSheets.alex?.frameBounds[0];
                            if (alexFrame0Bounds && frameBounds.height >= 250) {
                                const estimatedBottomPadding = 30;
                                adjustedHeight = Math.max(frameBounds.height - estimatedBottomPadding, alexFrame0Bounds.height);
                            }
                        }
                        const spriteBottomInFrame = frameBounds.offsetY + adjustedHeight;
                        this.y = tileWorldBounds.y - (spriteBottomInFrame * this.scale);
                    } else {
                        this.y = tileWorldBounds.y - this.height;
                    }
                    this.onGround = true;
                    this.velocityY = 0;
                    break;
                }
            }
        }
        
        // Boundary collision - characters can move freely in world space
        // No boundary restrictions (world is infinite)
        
        // Ensure onGround is true when idle/walking and not moving vertically
        // This fixes the issue where characters cannot jump from standing
        if ((this.state === 'idle' || this.state === 'walk') && this.velocityY === 0) {
            // Re-check ground collision for idle/walking characters
            const worldGroundY = canvas.height - 50;
            const animFrames = this.animations[this.state] || this.animations.idle;
            const frameIndex = animFrames[this.currentFrame] || 0;
            const frameBounds = this.spriteSheet.frameBounds[frameIndex];
            
            let currentFeetY;
            if (frameBounds) {
                let adjustedHeight = frameBounds.height;
                if (this.name === 'Steve' && frameIndex === this.animations.idle[0]) {
                    const alexFrame0Bounds = game.spriteSheets.alex?.frameBounds[0];
                    if (alexFrame0Bounds && frameBounds.height >= 250) {
                        const estimatedBottomPadding = 30;
                        adjustedHeight = Math.max(frameBounds.height - estimatedBottomPadding, alexFrame0Bounds.height);
                    }
                }
                const spriteBottomInFrame = frameBounds.offsetY + adjustedHeight;
                currentFeetY = this.y + (spriteBottomInFrame * this.scale);
            } else {
                currentFeetY = this.y + this.height;
            }
            
            // Check if character is on ground or very close to it (larger tolerance)
            // If character is idle/walking with no vertical velocity and close to ground, they must be on ground
            if (currentFeetY >= worldGroundY - 5) { // Larger tolerance for floating point precision
                this.onGround = true;
            }
        }
        
        // Transition from jump to walk/idle when landing
        if (this.state === 'jump' && this.onGround) {
            // If moving horizontally, transition to walk; otherwise idle
            if (this.velocityX !== 0) {
                this.state = 'walk';
            } else {
                this.state = 'idle';
            }
        }
        
        // Update animation
        this.frameCounter++;
        if (this.frameCounter >= this.animationSpeed) {
            this.frameCounter = 0;
            const animFrames = this.animations[this.state] || this.animations.idle;
            this.currentFrame = (this.currentFrame + 1) % animFrames.length;
        }
    }

    draw(ctx, cameraX = 0, cameraY = 0) {
        // Convert world coordinates to screen coordinates
        const screenX = this.x - cameraX;
        const screenY = this.y - cameraY;
        
        // Only draw if character is in viewport
        if (screenX + this.width < 0 || screenX > canvas.width ||
            screenY + this.height < 0 || screenY > canvas.height) {
            return;
        }
        
        ctx.save();
        
        // Flip horizontally if facing left
        if (this.facing === 'left') {
            ctx.scale(-1, 1);
            ctx.translate(-canvas.width, 0);
            const animFrames = this.animations[this.state] || this.animations.idle;
            const frameIndex = animFrames[this.currentFrame] || 0;
            this.spriteSheet.drawFrame(ctx, frameIndex, canvas.width - screenX - this.width, screenY, this.scale);
        } else {
            const animFrames = this.animations[this.state] || this.animations.idle;
            const frameIndex = animFrames[this.currentFrame] || 0;
            this.spriteSheet.drawFrame(ctx, frameIndex, screenX, screenY, this.scale);
        }
        
        ctx.restore();
        
        // Draw name label (always centered on character, regardless of facing direction)
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        const textX = screenX + this.width / 2;
        ctx.strokeText(this.name, textX, screenY - 10);
        ctx.fillText(this.name, textX, screenY - 10);
    }

    moveLeft() {
        this.velocityX = -this.speed;
        // Update facing direction - allow change during jump if movement direction changes
        // This prevents brief direction changes when jump is first pressed
        if (this.state !== 'jump' || this.facing !== 'left') {
            this.facing = 'left';
        }
        // Stop mining if moving
        if (this.state === 'mine') {
            game.mining.isMining = false;
            game.mining.targetTreeIndex = -1;
            this.state = this.onGround ? 'walk' : 'jump';
        } else if (this.state !== 'jump') {
            // Only update state if not already jumping (preserve jump state)
            this.state = this.onGround ? 'walk' : 'jump';
        }
    }

    moveRight() {
        this.velocityX = this.speed;
        // Update facing direction - allow change during jump if movement direction changes
        // This prevents brief direction changes when jump is first pressed
        if (this.state !== 'jump' || this.facing !== 'right') {
            this.facing = 'right';
        }
        // Stop mining if moving
        if (this.state === 'mine') {
            game.mining.isMining = false;
            game.mining.targetTreeIndex = -1;
            this.state = this.onGround ? 'walk' : 'jump';
        } else if (this.state !== 'jump') {
            // Only update state if not already jumping (preserve jump state)
            this.state = this.onGround ? 'walk' : 'jump';
        }
    }

    stop() {
        this.velocityX = 0;
        if (this.onGround) {
            this.state = 'idle';
        }
    }

    jump() {
        // Allow jump if on ground, or if idle/walking with no vertical velocity (standing still)
        // This ensures characters can always jump from standing position
        const canJump = this.onGround || ((this.state === 'idle' || this.state === 'walk') && this.velocityY === 0);
        if (canJump) {
            this.velocityY = this.jumpPower;
            this.onGround = false;
            this.state = 'jump';
        }
    }
    
    // Check if character is near a tree (for interaction)
    isNearTree(tree, range = 120) {
        // Use world bounds for collision detection
        const charWorldBounds = this.getWorldBounds();
        const charCenterX = charWorldBounds.x + charWorldBounds.width / 2;
        const charCenterY = charWorldBounds.y + charWorldBounds.height / 2;
        const treeWorldBounds = tree.getWorldBounds();
        const treeCenterX = treeWorldBounds.x + treeWorldBounds.width / 2;
        const treeCenterY = treeWorldBounds.y + treeWorldBounds.height / 2;
        
        const dx = charCenterX - treeCenterX;
        const dy = charCenterY - treeCenterY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        return distance < range;
    }
    
    // Check collision with a tile (axis-aligned bounding box collision)
    isCollidingWithTile(tile) {
        const charBounds = this.getCurrentBounds();
        const tileBounds = tile.getBounds();
        
        return charBounds.x < tileBounds.x + tileBounds.width &&
               charBounds.x + charBounds.width > tileBounds.x &&
               charBounds.y < tileBounds.y + tileBounds.height &&
               charBounds.y + charBounds.height > tileBounds.y;
    }
    
    // Get the tile the character is standing on (if any)
    getTileBelow() {
        const charWorldBounds = this.getWorldBounds();
        const charFeetY = charWorldBounds.y + charWorldBounds.height;
        const charLeftX = charWorldBounds.x;
        const charRightX = charWorldBounds.x + charWorldBounds.width;
        
        // Check all tiles to find one directly below the character
        // Use a wider check - character needs to overlap horizontally with the tile
        for (const tile of game.placedTiles) {
            const tileWorldBounds = tile.getWorldBounds();
            // Check if character overlaps horizontally with the tile
            const horizontalOverlap = charLeftX < tileWorldBounds.x + tileWorldBounds.width &&
                                     charRightX > tileWorldBounds.x;
            
            if (!horizontalOverlap) continue;
            
            // Check if character's feet are at or near the top of the tile
            // Increased tolerance for smoother stair transitions
            const tileTopY = tileWorldBounds.y;
            const tolerance = 8; // Increased tolerance for "standing on" (was 5)
            if (charFeetY >= tileTopY - tolerance && charFeetY <= tileTopY + tolerance) {
                return tile;
            }
        }
        return null;
    }
    
    // Get a tile that can be stepped up onto (for stairs)
    // Checks for a tile ahead in the movement direction that's slightly higher
    // Only returns a tile if there's a clear height difference (not adjacent tiles at same level)
    getStepUpTile() {
        if (this.velocityX === 0) return null;
        
        const charWorldBounds = this.getWorldBounds();
        const charFeetY = charWorldBounds.y + charWorldBounds.height;
        const charLeftX = charWorldBounds.x;
        const charRightX = charWorldBounds.x + charWorldBounds.width;
        
        // Check tiles ahead in the movement direction
        const checkAhead = this.velocityX > 0 ? charRightX + this.speed : charLeftX - this.speed;
        const direction = this.velocityX > 0 ? 1 : -1;
        
        let bestTile = null;
        let bestStepHeight = Infinity;
        
        for (const tile of game.placedTiles) {
            const tileWorldBounds = tile.getWorldBounds();
            const tileTopY = tileWorldBounds.y;
            
            // Check if tile is ahead in movement direction (not overlapping horizontally)
            // For step-up, we want tiles that are ahead, not tiles we're already on top of
            const tileAhead = direction > 0 ? 
                (tileWorldBounds.x >= charRightX - 2 && tileWorldBounds.x <= checkAhead) :
                (tileWorldBounds.x + tileWorldBounds.width <= charLeftX + 2 && tileWorldBounds.x + tileWorldBounds.width >= checkAhead);
            
            if (!tileAhead) continue;
            
            // Don't step up if we're already overlapping horizontally with the tile
            // This prevents stepping up onto adjacent tiles at the same level
            const horizontalOverlap = charLeftX < tileWorldBounds.x + tileWorldBounds.width &&
                                     charRightX > tileWorldBounds.x;
            
            // Only step up if tile is ahead (not overlapping) or very close to edge
            const veryCloseToEdge = direction > 0 ?
                (tileWorldBounds.x >= charRightX - 2 && tileWorldBounds.x <= charRightX + 5) :
                (tileWorldBounds.x + tileWorldBounds.width <= charLeftX + 2 && tileWorldBounds.x + tileWorldBounds.width >= charLeftX - 5);
            
            if (horizontalOverlap && !veryCloseToEdge) continue;
            
            // Check if tile is above current feet position (step up)
            // Require a minimum step height to avoid stepping up onto tiles at the same level
            const stepHeight = tileTopY - charFeetY;
            const minStepHeight = 2; // Minimum height difference to trigger step-up
            if (stepHeight >= minStepHeight && stepHeight < bestStepHeight && stepHeight <= 37) { // Max step height
                bestTile = tile;
                bestStepHeight = stepHeight;
            }
        }
        
        return bestTile;
    }
    
    // Get tiles that are colliding horizontally with the character
    // Excludes tiles the character is standing on top of
    getCollidingTilesHorizontal() {
        const collidingTiles = [];
        const charWorldBounds = this.getWorldBounds();
        const charFeetY = charWorldBounds.y + charWorldBounds.height;
        const charTopY = charWorldBounds.y;
        const charRightX = charWorldBounds.x + charWorldBounds.width;
        const charLeftX = charWorldBounds.x;
        
        for (const tile of game.placedTiles) {
            const tileWorldBounds = tile.getWorldBounds();
            const tileTopY = tileWorldBounds.y;
            const tileBottomY = tileWorldBounds.y + tileWorldBounds.height;
            const tileRightX = tileWorldBounds.x + tileWorldBounds.width;
            const tileLeftX = tileWorldBounds.x;
            
            // Check horizontal overlap (X axis collision)
            const horizontalOverlap = charLeftX < tileRightX &&
                                     charRightX > tileLeftX;
            
            if (!horizontalOverlap) continue;
            
            // Exclude tiles that the character is standing on top of
            // Character is standing on tile if feet are at or very close to tile top
            const standingOnTile = charFeetY >= tileTopY - 8 && charFeetY <= tileTopY + 8;
            
            if (standingOnTile) continue;
            
            // Check if character is vertically overlapping with tile (not just adjacent)
            // Character must be at a similar vertical level to the tile
            const verticalOverlap = charTopY < tileBottomY &&
                                  charFeetY > tileTopY;
            
            if (!verticalOverlap) continue;
            
            // Only consider it a horizontal collision if character is actually moving into the tile
            // or if the character is significantly overlapping (more than just touching edges)
            const movingRight = this.velocityX > 0;
            const movingLeft = this.velocityX < 0;
            
            // Check if character is moving into the tile from the side
            const movingIntoFromRight = movingRight && charLeftX < tileRightX && charRightX >= tileLeftX;
            const movingIntoFromLeft = movingLeft && charRightX > tileLeftX && charLeftX <= tileRightX;
            
            // Also check for significant overlap (character is already partially inside the tile)
            // This handles cases where character is already overlapping but not moving
            const significantOverlap = horizontalOverlap && 
                ((charLeftX < tileLeftX + charWorldBounds.width * 0.3) || 
                 (charRightX > tileRightX - charWorldBounds.width * 0.3));
            
            // Only block if character is moving into the tile or significantly overlapping
            if (movingIntoFromRight || movingIntoFromLeft || significantOverlap) {
                collidingTiles.push(tile);
            }
        }
        
        return collidingTiles;
    }
}

// Spark Particle Class (for hit effects)
class SparkParticle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.size = 2 + Math.random() * 3; // Random size between 2-5 pixels
        
        // Physics - sparks fly outward in a cone
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI / 3; // Cone shape (mostly upward)
        const speed = 1.5 + Math.random() * 2; // Random speed between 1.5-3.5
        this.velocityX = Math.cos(angle) * speed;
        this.velocityY = Math.sin(angle) * speed;
        this.gravity = 0.15;
        
        // Color - yellow/orange sparks
        const colorVariation = Math.random();
        if (colorVariation < 0.5) {
            this.color = '#FFD700'; // Gold
        } else if (colorVariation < 0.75) {
            this.color = '#FFA500'; // Orange
        } else {
            this.color = '#FF8C00'; // Dark orange
        }
        
        // Lifecycle
        this.createdAt = Date.now();
        this.maxLifetime = 400; // 0.4 seconds - sparks are short-lived
        this.alpha = 1.0;
    }
    
    update() {
        // Apply gravity
        this.velocityY += this.gravity;
        
        // Update position
        this.x += this.velocityX;
        this.y += this.velocityY;
        
        // Fade out quickly
        const elapsed = Date.now() - this.createdAt;
        const fadeStart = this.maxLifetime * 0.3; // Start fading at 30% of lifetime
        if (elapsed > fadeStart) {
            const fadeProgress = (elapsed - fadeStart) / (this.maxLifetime - fadeStart);
            this.alpha = Math.max(0, 1.0 - fadeProgress);
        }
        
        // Shrink slightly over time
        this.size *= 0.98;
    }
    
    draw(ctx, cameraX = 0, cameraY = 0) {
        ctx.save();
        
        // Convert world coordinates to screen coordinates
        const screenX = this.x - cameraX;
        const screenY = this.y - cameraY;
        
        // Apply alpha
        ctx.globalAlpha = this.alpha;
        
        // Draw spark as a small circle with glow effect
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 4;
        ctx.shadowColor = this.color;
        
        ctx.beginPath();
        ctx.arc(screenX, screenY, this.size, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw a brighter center
        ctx.globalAlpha = this.alpha * 0.8;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(screenX, screenY, this.size * 0.5, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    }
    
    isDead() {
        const elapsed = Date.now() - this.createdAt;
        return elapsed >= this.maxLifetime || this.alpha <= 0 || this.size < 0.5;
    }
}

// Wood Particle Class (for explosion animation)
class WoodParticle {
    constructor(spriteSheet, frameIndex, x, y) {
        this.spriteSheet = spriteSheet;
        this.frameIndex = frameIndex;
        this.x = x;
        this.y = y;
        // Small scale for particles (much smaller than inventory display)
        this.scale = 0.15; // Small wood sprites
        this.width = spriteSheet.frameWidth * this.scale;
        this.height = spriteSheet.frameHeight * this.scale;
        
        // Physics
        const angle = Math.random() * Math.PI * 2; // Random direction
        const speed = 2 + Math.random() * 3; // Random speed between 2-5
        this.velocityX = Math.cos(angle) * speed;
        this.velocityY = Math.sin(angle) * speed - 2; // Slight upward bias
        this.gravity = 0.3;
        this.rotation = Math.random() * Math.PI * 2; // Random initial rotation
        this.rotationSpeed = (Math.random() - 0.5) * 0.2; // Random rotation speed
        
        // Lifecycle
        this.createdAt = Date.now();
        this.maxLifetime = 2000; // 2 seconds
        this.alpha = 1.0;
    }
    
    update() {
        // Apply gravity
        this.velocityY += this.gravity;
        
        // Update position
        this.x += this.velocityX;
        this.y += this.velocityY;
        
        // Update rotation
        this.rotation += this.rotationSpeed;
        
        // Update lifetime and fade out based on actual elapsed time
        const elapsed = Date.now() - this.createdAt;
        const fadeStart = this.maxLifetime * 0.6; // Start fading at 60% of lifetime
        if (elapsed > fadeStart) {
            const fadeProgress = (elapsed - fadeStart) / (this.maxLifetime - fadeStart);
            this.alpha = Math.max(0, 1.0 - fadeProgress);
        }
        
        // Ground collision (world coordinates)
        const worldGroundY = canvas.height - 50; // Fixed world ground Y position
        if (this.y + this.height > worldGroundY) {
            this.y = worldGroundY - this.height;
            this.velocityY *= -0.3; // Bounce with damping
            this.velocityX *= 0.8; // Friction
            if (Math.abs(this.velocityY) < 0.5) {
                this.velocityY = 0; // Stop bouncing when too slow
            }
        }
    }
    
    draw(ctx, cameraX = 0, cameraY = 0) {
        ctx.save();
        
        // Convert world coordinates to screen coordinates
        const screenX = this.x - cameraX;
        const screenY = this.y - cameraY;
        
        // Apply alpha
        ctx.globalAlpha = this.alpha;
        
        // Translate to center, rotate, then translate back
        const centerX = screenX + this.width / 2;
        const centerY = screenY + this.height / 2;
        ctx.translate(centerX, centerY);
        ctx.rotate(this.rotation);
        ctx.translate(-centerX, -centerY);
        
        // Draw the wood sprite
        this.spriteSheet.drawFrame(ctx, this.frameIndex, screenX, screenY, this.scale);
        
        ctx.restore();
    }
    
    isDead() {
        const elapsed = Date.now() - this.createdAt;
        return elapsed >= this.maxLifetime || this.alpha <= 0;
    }
}

// Tile Class (for placed materials)
class Tile {
    constructor(spriteSheet, x, y, frameIndex, materialName) {
        this.spriteSheet = spriteSheet;
        this.x = x; // World X coordinate
        this.y = y; // World Y coordinate
        this.frameIndex = frameIndex;
        this.materialName = materialName;
        // Calculate tile size - materials are 2048x2048px image with 3x3 grid
        // Each tile is approximately 682x682px, but we'll scale it down for the game
        const tileSize = 32; // Size of tiles in the game world (reduced from 64)
        this.scale = tileSize / spriteSheet.frameWidth;
        this.width = spriteSheet.frameWidth * this.scale;
        this.height = spriteSheet.frameHeight * this.scale;
    }
    
    draw(ctx, cameraX = 0, cameraY = 0) {
        if (this.frameIndex >= 0 && this.frameIndex < this.spriteSheet.totalFrames) {
            // Convert world coordinates to screen coordinates
            const screenX = this.x - cameraX;
            const screenY = this.y - cameraY;
            this.spriteSheet.drawFrame(ctx, this.frameIndex, screenX, screenY, this.scale);
        }
    }
    
    getBounds(cameraX = 0, cameraY = 0) {
        return {
            x: this.x - cameraX, // Screen X
            y: this.y - cameraY, // Screen Y
            width: this.width,
            height: this.height
        };
    }
    
    // Get world bounds (for collision detection)
    getWorldBounds() {
        return {
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height
        };
    }
    
    // Serialize for localStorage
    toJSON() {
        return {
            x: this.x,
            y: this.y,
            frameIndex: this.frameIndex,
            materialName: this.materialName
        };
    }
    
    // Deserialize from localStorage
    static fromJSON(data, spriteSheet) {
        return new Tile(spriteSheet, data.x, data.y, data.frameIndex, data.materialName);
    }
}

// Tree Class
// Mob Class
class Mob {
    constructor(spriteSheet, x, y, mobType = 'zombie', facing = 'right') {
        this.spriteSheet = spriteSheet;
        this.x = x; // World X position
        this.y = y; // World Y position
        this.mobType = mobType; // 'zombie', 'skeleton', 'creeper', 'spider', 'slime', 'pig'
        this.facing = facing; // 'left' or 'right'
        this.state = 'idle'; // 'idle' or 'walking'
        
        // Mob type to row mapping (each mob type is in its own row)
        const mobRowMap = {
            'zombie': 0,
            'skeleton': 1,
            'creeper': 2,
            'spider': 3,
            'slime': 4,
            'pig': 5
        };
        this.rowIndex = mobRowMap[mobType] || 0;
        
        // Animation
        this.currentFrame = 0;
        this.frameCounter = 0;
        this.animationSpeed = 20; // frames per animation frame
        
        // Calculate frame index based on mob type, facing, and state
        this.updateFrameIndex();
        
        // Scale - make mobs reasonable size (similar to characters)
        const targetHeight = 50; // Target height in pixels
        this.scale = targetHeight / spriteSheet.frameHeight;
        this.width = spriteSheet.frameWidth * this.scale;
        this.height = spriteSheet.frameHeight * this.scale;
        
        // Movement
        this.velocityX = 0;
        this.walkSpeed = 0.8 + Math.random() * 0.4; // Random walk speed between 0.8-1.2 pixels per frame
        this.walkDuration = 2000 + Math.random() * 3000; // Walk for 2-5 seconds
        this.idleDuration = 1000 + Math.random() * 2000; // Idle for 1-3 seconds
        this.lastStateChange = Date.now();
    }
    
    updateFrameIndex() {
        // Calculate base frame index for this mob type's row
        // With 6 columns per row, we can have more animation frames
        const cols = this.spriteSheet.cols;
        const baseFrame = this.rowIndex * cols;
        
        if (this.state === 'walking') {
            // Walking animation - always use right-facing frames (0-2) and flip horizontally when facing left
            // With 6 columns: frames 0-2 for walking animation
            if (cols >= 6) {
                // Use frames 0-2 for walking animation (will be flipped if facing left)
                const walkFrames = [baseFrame, baseFrame + 1, baseFrame + 2];
                this.frameIndex = walkFrames[this.currentFrame % 3];
            } else if (cols >= 4) {
                // Use frames 0-1 for walking animation (will be flipped if facing left)
                const walkFrames = [baseFrame, baseFrame + 1];
                this.frameIndex = walkFrames[this.currentFrame % 2];
            } else {
                // Simple 1-frame walking (will be flipped if facing left)
                this.frameIndex = baseFrame;
            }
        } else if (this.state === 'idle') {
            // Idle animation - use first frame of the row (will be flipped if facing left)
            this.frameIndex = baseFrame;
        }
    }
    
    update() {
        const currentTime = Date.now();
        const timeSinceStateChange = currentTime - this.lastStateChange;
        
        // State machine: idle <-> walking
        if (this.state === 'walking') {
            // Update position based on velocity
            const newX = this.x + this.velocityX;
            
            // Boundary checking - keep mobs within reasonable world bounds
            const minX = -500;
            const maxX = 10000;
            
            if (newX >= minX && newX <= maxX) {
                this.x = newX;
            } else {
                // Hit boundary - turn around
                this.facing = this.facing === 'right' ? 'left' : 'right';
                this.velocityX = this.facing === 'right' ? this.walkSpeed : -this.walkSpeed;
            }
            
            // Check if we should stop walking
            if (timeSinceStateChange > this.walkDuration) {
                this.state = 'idle';
                this.velocityX = 0;
                this.lastStateChange = currentTime;
                this.idleDuration = 1000 + Math.random() * 2000;
                this.currentFrame = 0;
                this.updateFrameIndex();
            }
        } else if (this.state === 'idle') {
            // Check if we should start walking
            if (timeSinceStateChange > this.idleDuration) {
                // Randomly choose direction
                this.facing = Math.random() < 0.5 ? 'left' : 'right';
                this.velocityX = this.facing === 'right' ? this.walkSpeed : -this.walkSpeed;
                this.state = 'walking';
                this.lastStateChange = currentTime;
                this.walkDuration = 2000 + Math.random() * 3000;
                this.updateFrameIndex();
            }
        }
        
        // Update animation
        this.frameCounter++;
        if (this.frameCounter >= this.animationSpeed) {
            this.frameCounter = 0;
            // For walking, cycle through animation frames
            if (this.state === 'walking') {
                this.currentFrame++;
            }
            this.updateFrameIndex();
        }
    }
    
    draw(ctx, cameraX = 0, cameraY = 0) {
        // Convert world coordinates to screen coordinates
        const screenX = this.x - cameraX;
        const screenY = this.y - cameraY;
        
        // Only draw if mob is in viewport
        if (screenX + this.width < 0 || screenX > canvas.width ||
            screenY + this.height < 0 || screenY > canvas.height) {
            return;
        }
        
        ctx.save();
        
        // For slimes, clip the bottom 8 pixels to truncate the sprite
        if (this.mobType === 'slime') {
            const bottomClipPixels = 8 * this.scale; // Convert to screen pixels
            ctx.beginPath();
            ctx.rect(screenX, screenY, this.width, this.height - bottomClipPixels);
            ctx.clip();
        }
        
        // Flip horizontally if facing left
        if (this.facing === 'left') {
            ctx.scale(-1, 1);
            // Draw flipped - adjust x position to account for flip
            const flippedX = -(screenX + this.width);
            if (this.frameIndex >= 0 && this.frameIndex < this.spriteSheet.totalFrames) {
                this.spriteSheet.drawFrame(ctx, this.frameIndex, flippedX, screenY, this.scale);
            }
        } else {
            // Draw normally when facing right
            if (this.frameIndex >= 0 && this.frameIndex < this.spriteSheet.totalFrames) {
                this.spriteSheet.drawFrame(ctx, this.frameIndex, screenX, screenY, this.scale);
            }
        }
        
        ctx.restore();
    }
    
    getWorldBounds() {
        return {
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height
        };
    }
    
    getBounds(cameraX = 0, cameraY = 0) {
        return {
            x: this.x - cameraX,
            y: this.y - cameraY,
            width: this.width,
            height: this.height
        };
    }
}

// Chicken Class
class Chicken {
    constructor(spriteSheet, x, y, color = 'white', facing = 'right') {
        this.spriteSheet = spriteSheet;
        this.x = x; // World X position
        this.y = y; // World Y position
        this.color = color; // 'white' or 'red'
        this.facing = facing; // 'left' or 'right'
        this.state = 'idle'; // 'idle', 'walking', or 'pecking'
        
        // Animation
        this.currentFrame = 0;
        this.frameCounter = 0;
        this.animationSpeed = 30; // frames per animation frame (slower for chickens - increased from 15)
        
        // Calculate frame index based on color, facing, and state
        // Row 1: white right (0), white left (1), red right (2), red left (3)
        // Row 2: white right pecking (4), white left pecking (5), red right pecking (6), red left pecking (7)
        this.updateFrameIndex();
        
        // Scale - make chickens reasonable size (smaller than characters)
        const targetHeight = 30; // Target height in pixels (increased from 20)
        this.scale = targetHeight / spriteSheet.frameHeight;
        this.width = spriteSheet.frameWidth * this.scale;
        this.height = spriteSheet.frameHeight * this.scale;
        
        // Movement
        this.velocityX = 0;
        this.walkSpeed = 0.5 + Math.random() * 0.5; // Random walk speed between 0.5-1.0 pixels per frame
        this.walkTimer = 0;
        this.walkDuration = 2000 + Math.random() * 3000; // Walk for 2-5 seconds
        this.idleDuration = 1000 + Math.random() * 2000; // Idle for 1-3 seconds
        this.lastStateChange = Date.now();
        
        // Behavior
        this.peckTimer = 0;
        this.peckInterval = 3000 + Math.random() * 2000; // Peck every 3-5 seconds
        this.lastPeckTime = Date.now();
    }
    
    updateFrameIndex() {
        // Animation frame mappings:
        // Moving right: white=0, red=3
        // Moving left: white=1, red=2
        // Idle cycles: white=[0,4,1,5], red=[2,6,3,7]
        
        if (this.state === 'walking') {
            // Walking animation - use moving frames based on facing direction
            if (this.color === 'white') {
                this.frameIndex = this.facing === 'right' ? 0 : 1;
            } else { // red
                this.frameIndex = this.facing === 'right' ? 3 : 2;
            }
        } else if (this.state === 'idle') {
            // Idle animation cycles through frames
            const idleFrames = this.color === 'white' 
                ? [0, 4, 1, 5]  // white idle cycle
                : [2, 6, 3, 7]; // red idle cycle
            this.frameIndex = idleFrames[this.currentFrame % idleFrames.length];
        } else if (this.state === 'pecking') {
            // Pecking state - use facing direction frames + pecking offset
            if (this.color === 'white') {
                this.frameIndex = this.facing === 'right' ? 4 : 5; // pecking frames
            } else { // red
                this.frameIndex = this.facing === 'right' ? 6 : 7; // pecking frames
            }
        }
    }
    
    update() {
        const currentTime = Date.now();
        const timeSinceStateChange = currentTime - this.lastStateChange;
        
        // State machine: idle <-> walking, with occasional pecking
        if (this.state === 'walking') {
            // Update position based on velocity
            const newX = this.x + this.velocityX;
            
            // Boundary checking - keep chickens within reasonable world bounds
            // Allow chickens to walk in a range around their spawn area
            const minX = -500; // Allow some negative X for exploration
            const maxX = 10000; // Allow walking far to the right
            
            if (newX >= minX && newX <= maxX) {
                this.x = newX;
            } else {
                // Hit boundary - turn around
                this.facing = this.facing === 'right' ? 'left' : 'right';
                this.velocityX = this.facing === 'right' ? this.walkSpeed : -this.walkSpeed;
            }
            
            // Check if we should stop walking
            if (timeSinceStateChange > this.walkDuration) {
                this.state = 'idle';
                this.velocityX = 0;
                this.lastStateChange = currentTime;
                this.idleDuration = 1000 + Math.random() * 2000; // Random next idle duration
                this.currentFrame = 0; // Reset animation cycle
                this.updateFrameIndex();
            }
        } else if (this.state === 'idle') {
            // Check if we should start walking
            if (timeSinceStateChange > this.idleDuration) {
                // Randomly choose direction
                this.facing = Math.random() < 0.5 ? 'left' : 'right';
                this.velocityX = this.facing === 'right' ? this.walkSpeed : -this.walkSpeed;
                this.state = 'walking';
                this.lastStateChange = currentTime;
                this.walkDuration = 2000 + Math.random() * 3000; // Random walk duration
                this.updateFrameIndex();
            }
            
            // Randomly switch to pecking state (only when idle)
            if (currentTime - this.lastPeckTime > this.peckInterval) {
                this.state = 'pecking';
                this.velocityX = 0; // Stop moving when pecking
                this.updateFrameIndex();
                // Peck for a short duration (1-2 seconds)
                setTimeout(() => {
                    if (this.state === 'pecking') {
                        this.state = 'idle';
                        this.currentFrame = 0; // Reset animation cycle
                        this.updateFrameIndex();
                        this.lastPeckTime = Date.now();
                        this.peckInterval = 3000 + Math.random() * 2000; // Random next peck time
                        this.lastStateChange = Date.now(); // Reset idle timer
                    }
                }, 1000 + Math.random() * 1000);
            }
        } else if (this.state === 'pecking') {
            // Pecking state - handled by setTimeout callback above
            // Don't move while pecking
            this.velocityX = 0;
        }
        
        // Update animation
        this.frameCounter++;
        if (this.frameCounter >= this.animationSpeed) {
            this.frameCounter = 0;
            // For idle, cycle through animation frames
            if (this.state === 'idle') {
                this.currentFrame++;
            }
            this.updateFrameIndex();
        }
    }
    
    draw(ctx, cameraX = 0, cameraY = 0) {
        // Convert world coordinates to screen coordinates
        const screenX = this.x - cameraX;
        const screenY = this.y - cameraY;
        
        // Only draw if chicken is in viewport
        if (screenX + this.width < 0 || screenX > canvas.width ||
            screenY + this.height < 0 || screenY > canvas.height) {
            return;
        }
        
        // Ensure frame index is valid
        if (this.frameIndex >= 0 && this.frameIndex < this.spriteSheet.totalFrames) {
            this.spriteSheet.drawFrame(ctx, this.frameIndex, screenX, screenY, this.scale);
        }
    }
    
    getWorldBounds() {
        return {
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height
        };
    }
    
    getBounds(cameraX = 0, cameraY = 0) {
        return {
            x: this.x - cameraX,
            y: this.y - cameraY,
            width: this.width,
            height: this.height
        };
    }
}

class Tree {
    constructor(spriteSheet, x, y, frameIndex = 0) {
        this.spriteSheet = spriteSheet;
        this.x = x;
        this.y = y;
        this.frameIndex = frameIndex; // Which tree sprite to use
        // Adjust scale based on frame size - larger frames need smaller scale
        // For 194x260 frames, use a scale that makes trees reasonable size
        // Target height around 80-100 pixels
        const targetHeight = 90;
        this.scale = targetHeight / spriteSheet.frameHeight;
        this.width = spriteSheet.frameWidth * this.scale;
        this.height = spriteSheet.frameHeight * this.scale;
        this.health = 3; // Hits to chop down
        this.maxHealth = 3;
    }
    
    // Get the Y position where the tree's base (bottom of sprite content) should be
    // This accounts for transparent padding at the bottom of the sprite frame
    getBaseYPosition(groundY) {
        const frameBounds = this.spriteSheet.frameBounds[this.frameIndex];
        
        // If bounds not yet analyzed, try to use any available frame bounds
        if (!frameBounds) {
            // Try to use the first available frame bounds as an approximation
            const firstFrameBounds = Object.values(this.spriteSheet.frameBounds)[0];
            if (firstFrameBounds) {
                const spriteBottomInFrame = firstFrameBounds.offsetY + firstFrameBounds.height;
                return groundY - (spriteBottomInFrame * this.scale);
            }
            // Last resort: use full frame height
            return groundY - this.height;
        }
        
        // Calculate where the bottom of the actual sprite content is within the frame
        const spriteBottomInFrame = frameBounds.offsetY + frameBounds.height;
        
        // Convert to world coordinates and calculate Y position
        // We want: y + (spriteBottomInFrame * scale) = groundY
        // So: y = groundY - (spriteBottomInFrame * scale)
        return groundY - (spriteBottomInFrame * this.scale);
    }
    
    draw(ctx, cameraX = 0, cameraY = 0) {
        // Convert world coordinates to screen coordinates
        const screenX = this.x - cameraX;
        const screenY = this.y - cameraY;
        
        // Only draw if tree is in viewport
        if (screenX + this.width < 0 || screenX > canvas.width ||
            screenY + this.height < 0 || screenY > canvas.height) {
            return;
        }
        
        // Ensure frame index is valid
        if (this.frameIndex >= 0 && this.frameIndex < this.spriteSheet.totalFrames) {
            this.spriteSheet.drawFrame(ctx, this.frameIndex, screenX, screenY, this.scale);
        } else {
            console.warn(`Invalid frame index ${this.frameIndex} for tree (max: ${this.spriteSheet.totalFrames - 1})`);
            // Draw a placeholder rectangle if frame is invalid
            ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.fillRect(screenX, screenY, this.width, this.height);
        }
    }
    
    getBounds(cameraX = 0, cameraY = 0) {
        return {
            x: this.x - cameraX, // Screen X
            y: this.y - cameraY, // Screen Y
            width: this.width,
            height: this.height
        };
    }
    
    // Get world bounds (for collision detection)
    getWorldBounds() {
        return {
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height
        };
    }
    
    // Hit the tree (returns true if tree is destroyed)
    hit() {
        this.health--;
        return this.health <= 0;
    }
}

// Inventory Item Class
class InventoryItem {
    constructor(spriteSheet, frameIndex, name, count = 1) {
        this.spriteSheet = spriteSheet;
        this.frameIndex = frameIndex;
        this.name = name;
        this.count = count;
    }
    
    draw(ctx, x, y, size = 32) {
        this.spriteSheet.drawFrame(ctx, this.frameIndex, x, y, size / this.spriteSheet.frameWidth);
    }
}

// Load sprite sheets
function loadSpriteSheet(name, filename, frameWidth, frameHeight, cols, rows) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        
        // Only set crossOrigin for http/https protocols, not file://
        // Setting crossOrigin on file:// causes CORS errors that prevent image loading
        // For file:// protocol, we skip crossOrigin and images will load normally
        // (alpha channel analysis will use fallback bounds for file://)
        const isHttp = window.location.protocol === 'http:' || window.location.protocol === 'https:';
        if (isHttp) {
            img.crossOrigin = 'anonymous';
        }
        
        img.onload = async () => {
            const spriteSheet = new SpriteSheet(img, frameWidth, frameHeight, cols, rows);
            game.spriteSheets[name] = spriteSheet;
            
            // Analyze all frames for alpha channel bounding boxes
            // This may fail for local files due to CORS, but will use fallback bounds
            console.log(`Analyzing alpha channels for ${name}...`);
            try {
                await spriteSheet.analyzeAllFrames();
                console.log(`Analysis complete for ${name}`);
            } catch (error) {
                console.warn(`Alpha analysis failed for ${name} (likely CORS restriction with local files). Using full frame bounds.`);
                console.warn('Tip: Use a local web server (e.g., `python -m http.server`) for full alpha channel support.');
            }
            
            resolve(spriteSheet);
        };
        img.onerror = (error) => {
            console.error(`Failed to load sprite sheet ${name} from ${filename}:`, error);
            reject(error);
        };
        img.src = filename;
    });
}

// Load JSON configuration file
async function loadCharacterConfig(filename) {
    try {
        const response = await fetch(filename);
        if (!response.ok) throw new Error(`Failed to load ${filename}`);
        return await response.json();
    } catch (error) {
        console.warn(`Could not load config file ${filename}, using defaults:`, error);
        return null;
    }
}

// Load object configuration (inventory, trees, etc.)
async function loadObjectConfig(filename) {
    try {
        const response = await fetch(filename);
        if (!response.ok) throw new Error(`Failed to load ${filename}`);
        return await response.json();
    } catch (error) {
        console.warn(`Could not load object config file ${filename}, using defaults:`, error);
        return null;
    }
}

// Character configurations
// You can also load from JSON files exported from the sprite editor
// by uncommenting the loadCharacterConfig calls below
const characterConfigs = {
    steve: {
        spriteSheet: 'steve.png',
        frameWidth: 256,
        frameHeight: 256,
        cols: 4,
        rows: 4,
        scale: 0.3, // Adjusted for 256x256 frames
        animations: {
            idle: [3],
            walk: [14,11],
            jump: [11],
            mine: [14,15,11]
        }
    },
    alex: {
        spriteSheet: 'alex.png',
        frameWidth: 256, // Update this when you get Alex's config from the sprite editor
        frameHeight: 256,
        cols: 4,
        rows: 4,
        scale: 0.3,
        animations: {
            idle: [0],
            walk: [8,9,10,11],
            jump: [9],
            mine: [8, 9]
        }
    }
};

// Initialize game
async function initGame() {
    try {
        // Optionally load configs from JSON files (uncomment to use)
        // const steveJsonConfig = await loadCharacterConfig('steve-sprite-config.json');
        // const alexJsonConfig = await loadCharacterConfig('alex-sprite-config.json');
        
        // Use JSON configs if available, otherwise use defaults
        const steveConfig = characterConfigs.steve; // || steveJsonConfig || characterConfigs.steve;
        const alexConfig = characterConfigs.alex; // || alexJsonConfig || characterConfigs.alex;
        
        // Load inventory config first (if available)
        const inventoryConfig = await loadObjectConfig('inventory-sprite-config.json');
        let inventoryMappings = null;
        if (inventoryConfig && inventoryConfig.objectMappings && inventoryConfig.objectMappings.inventory) {
            inventoryMappings = inventoryConfig.objectMappings.inventory;
        }
        
        // Load trees config (if available)
        const treesConfig = await loadObjectConfig('trees-sprite-config.json');
        let treesMappings = null;
        let shrubsMappings = null;
        if (treesConfig && treesConfig.objectMappings) {
            if (treesConfig.objectMappings.trees) {
                treesMappings = treesConfig.objectMappings.trees;
            }
            if (treesConfig.objectMappings.shrubs) {
                shrubsMappings = treesConfig.objectMappings.shrubs;
            }
        }
        
        // Load materials sprite sheet (2048x2048px, 3x3 grid = 9 tiles)
        // Each tile is approximately 682x682px
        const tileSize = Math.floor(2048 / 3); // ~682px per tile
        
        // Define material mappings (order in 3x3 grid, left to right, top to bottom)
        const materialsMappings = {
            'dirt': 0,
            'wood': 1,
            'clay': 2,
            'stone': 3,
            'iron': 4,
            'silver': 5,
            'gold': 6,
            'sand': 7,
            'snow': 8
        };
        game.materialsMappings = materialsMappings;
        
        // Load sprite sheets based on configurations
        const loadPromises = [
            loadSpriteSheet(
                'steve',
                steveConfig.spriteSheet,
                steveConfig.frameWidth,
                steveConfig.frameHeight,
                steveConfig.cols,
                steveConfig.rows
            ),
            loadSpriteSheet(
                'alex',
                alexConfig.spriteSheet,
                alexConfig.frameWidth,
                alexConfig.frameHeight,
                alexConfig.cols,
                alexConfig.rows
            ),
            // Load inventory sprite sheet
            loadSpriteSheet(
                'inventory',
                inventoryConfig?.spriteSheet || 'inventory.png',
                inventoryConfig?.frameWidth || 164,
                inventoryConfig?.frameHeight || 169,
                inventoryConfig?.cols || 6,
                inventoryConfig?.rows || 2
            ),
            // Load trees and shrubs sprite sheet
            loadSpriteSheet(
                'trees',
                treesConfig?.spriteSheet || 'trees.png',
                treesConfig?.frameWidth || 194,
                treesConfig?.frameHeight || 260,
                treesConfig?.cols || 5,
                treesConfig?.rows || 4
            ),
            // Load materials sprite sheet for tile placement
            loadSpriteSheet(
                'materials',
                'materials.png',
                tileSize,
                tileSize,
                3,
                3
            ),
            // Load chickens sprite sheet (4 columns, 2 rows = 8 frames)
            // Frame dimensions: 193x170
            loadSpriteSheet(
                'chickens',
                'chickens.png',
                193, // frameWidth
                170, // frameHeight
                4,   // cols
                2    // rows
            ),
            // Load mobs sprite sheet (6 rows, each row is a different mob type)
            // Frame dimensions: 160x180, 6 columns, 6 rows
            loadSpriteSheet(
                'mobs',
                'mobs.png',
                160, // frameWidth
                180, // frameHeight
                6,   // cols
                6    // rows
            )
        ];
        
        await Promise.all(loadPromises);
        
        // Adjust pig frame bounds - move top border up by reducing offsetY
        if (game.spriteSheets.mobs) {
            const pigRowIndex = 5; // Pigs are in row 5 (0-indexed)
            const cols = game.spriteSheets.mobs.cols;
            const topBorderAdjustment = 5; // Move top border up by 5 pixels
            
            // Adjust all pig frames (all columns in row 5)
            for (let col = 0; col < cols; col++) {
                const pigFrameIndex = pigRowIndex * cols + col;
                const pigFrameBounds = game.spriteSheets.mobs.frameBounds[pigFrameIndex];
                if (pigFrameBounds) {
                    // Reduce offsetY to move top border up (detect sprite content starting higher)
                    pigFrameBounds.offsetY = Math.max(0, pigFrameBounds.offsetY - topBorderAdjustment);
                    // Adjust y coordinate accordingly
                    pigFrameBounds.y = pigFrameBounds.offsetY;
                }
            }
            
        }
        
        // Store mappings for later use
        if (inventoryMappings) {
            game.inventoryMappings = inventoryMappings;
        }
        if (treesMappings) {
            game.treesMappings = treesMappings;
        }
        if (shrubsMappings) {
            game.shrubsMappings = shrubsMappings;
        }
        
        // Create characters with their configurations
        // Position characters on the ground using frame bounds to account for transparent padding
        // Use world coordinates - start at world x=0, ground at world y = canvas.height - 50
        const worldGroundY = canvas.height - 50; // World ground Y position
        
        const steveChar = new Character(
            'Steve',
            game.spriteSheets.steve,
            100, // World X position
            0, // Will be set to ground position below
            {
                scale: steveConfig.scale,
                animations: steveConfig.animations,
                showBounds: false // Set to true to see bounding boxes
            }
        );
        // Position based on actual sprite bottom (feet), accounting for transparent padding
        // Force Steve to use idle frame for initial positioning
        const steveIdleFrame = steveConfig.animations.idle[0];
        const steveFrameBounds = game.spriteSheets.steve.frameBounds[steveIdleFrame];
        if (steveFrameBounds) {
            // Steve's frame 4 bounds show height=255 (almost full frame), but visually there IS bottom padding
            // The frame bounds analysis is incorrectly including transparent/semi-transparent pixels
            // Adjust by reducing the detected height to account for actual bottom padding
            // Compare to Alex: Alex has ~33px bottom padding (256-223), estimate similar for Steve
            const alexFrame0Bounds = game.spriteSheets.alex.frameBounds[0];
            let adjustedHeight = steveFrameBounds.height;
            
            // If Steve's detected height is suspiciously large (close to full frame), reduce it
            // Use Alex's padding as reference: if Alex has ~33px bottom padding, Steve should have similar
            if (alexFrame0Bounds && steveFrameBounds.height >= 250) {
                // Estimate bottom padding: Alex's actual content ends at 223, so ~33px padding
                // Apply similar padding estimate to Steve
                const estimatedBottomPadding = 30; // Pixels of transparent padding at bottom
                adjustedHeight = Math.max(steveFrameBounds.height - estimatedBottomPadding, alexFrame0Bounds.height);
            }
            
            const steveSpriteBottom = steveFrameBounds.offsetY + adjustedHeight;
            steveChar.y = worldGroundY - (steveSpriteBottom * steveChar.scale);
        } else {
            // Fallback to getFeetYPosition method
            steveChar.y = steveChar.getFeetYPosition(worldGroundY);
        }
        game.characters.push(steveChar);
        
        const alexChar = new Character(
            'Alex',
            game.spriteSheets.alex,
            500, // World X position
            0, // Will be set to ground position below
            {
                scale: alexConfig.scale,
                animations: alexConfig.animations,
                showBounds: false // Set to true to see bounding boxes
            }
        );
        // Position based on actual sprite bottom (feet), accounting for transparent padding
        const alexIdleFrame = alexConfig.animations.idle[0];
        const alexFrameBounds = game.spriteSheets.alex.frameBounds[alexIdleFrame];
        if (alexFrameBounds) {
            const alexSpriteBottom = alexFrameBounds.offsetY + alexFrameBounds.height;
            alexChar.y = worldGroundY - (alexSpriteBottom * alexChar.scale);
        } else {
            alexChar.y = alexChar.getFeetYPosition(worldGroundY);
        }
        game.characters.push(alexChar);
        
        // Create trees in the world (after sprite sheets are loaded)
        // Trees will be spawned procedurally across the entire map
        if (game.spriteSheets.trees) {
            game.trees = [];
            // Spawn initial trees around the starting area
            spawnTreesInArea(-500, 2000, worldGroundY);
            console.log(`Initial trees spawned: ${game.trees.length}`);
        } else {
            console.warn('Trees sprite sheet not loaded!');
        }
        
        // Create chickens in the world
        if (game.spriteSheets.chickens) {
            const worldGroundY = canvas.height - 50;
            const chickens = [
                new Chicken(game.spriteSheets.chickens, 200, 0, 'white', 'right'),
                new Chicken(game.spriteSheets.chickens, 300, 0, 'white', 'left'),
                new Chicken(game.spriteSheets.chickens, 400, 0, 'red', 'right'),
                new Chicken(game.spriteSheets.chickens, 600, 0, 'red', 'left')
            ];
            
            // Position chickens on the ground (based on white chicken frame bounds)
            // Use white chicken frames (0 and 1) as reference for consistent positioning
            const whiteChickenRightFrame = game.spriteSheets.chickens.frameBounds[0]; // White right
            const whiteChickenLeftFrame = game.spriteSheets.chickens.frameBounds[1]; // White left
            
            chickens.forEach((chicken, index) => {
                // Use white chicken frame bounds as reference (they have correct offsetY)
                const referenceFrameBounds = whiteChickenRightFrame || whiteChickenLeftFrame;
                
                if (referenceFrameBounds) {
                    // Calculate where the bottom of the white chicken sprite content is within the frame
                    const spriteBottomInFrame = referenceFrameBounds.offsetY + referenceFrameBounds.height;
                    // Position so the bottom of the sprite aligns with the ground
                    // Add a small offset to lower chickens slightly (they were too high)
                    const groundOffset = 3; // Lower chickens by 3 pixels
                    chicken.y = worldGroundY - (spriteBottomInFrame * chicken.scale) + groundOffset;
                } else {
                    // Fallback: position bottom of chicken at ground level
                    // Use a small offset to account for feet/padding
                    const feetOffset = 5; // Increased offset to lower chickens
                    chicken.y = worldGroundY - chicken.height + feetOffset;
                }
            });
            
            game.chickens = chickens;
            console.log(`Created ${chickens.length} chickens`);
        } else {
            console.warn('Chickens sprite sheet not loaded!');
        }
        
        // Create mobs in the world
        if (game.spriteSheets.mobs) {
            const worldGroundY = canvas.height - 50;
            const mobTypes = ['zombie', 'skeleton', 'creeper', 'spider', 'slime', 'pig'];
            const mobs = [];
            
            // Spawn a few mobs of each type
            mobTypes.forEach((mobType, typeIndex) => {
                // Spawn 2-3 mobs of each type
                const count = 2 + Math.floor(Math.random() * 2);
                for (let i = 0; i < count; i++) {
                    const spawnX = 800 + typeIndex * 200 + i * 150 + Math.random() * 100;
                    const facing = Math.random() < 0.5 ? 'left' : 'right';
                    const mob = new Mob(game.spriteSheets.mobs, spawnX, 0, mobType, facing);
                    mobs.push(mob);
                }
            });
            
            // Position mobs on the ground
            // Use each mob's own frame bounds for accurate positioning
            mobs.forEach((mob) => {
                // Get the base frame for this mob type (first frame of its row)
                const mobBaseFrame = mob.rowIndex * game.spriteSheets.mobs.cols;
                const mobFrameBounds = game.spriteSheets.mobs.frameBounds[mobBaseFrame];
                
                // Spiders, pigs, and slimes may need additional ground offset to prevent floating
                let groundOffset = 0;
                if (mob.mobType === 'slime') {
                    groundOffset = 15; // Lower slimes by 10 pixels
                } else if (mob.mobType === 'spider' || mob.mobType === 'pig') {
                    groundOffset = 3; // Lower spiders and pigs by 3 pixels
                }
                
                if (mobFrameBounds) {
                    // Calculate where the bottom of the sprite content is within the frame
                    const spriteBottomInFrame = mobFrameBounds.offsetY + mobFrameBounds.height;
                    // Position so the bottom of the sprite aligns with the ground
                    mob.y = worldGroundY - (spriteBottomInFrame * mob.scale) + groundOffset;
                } else {
                    // Fallback: position bottom of mob at ground level
                    mob.y = worldGroundY - mob.height + groundOffset;
                }
            });
            
            game.mobs = mobs;
            console.log(`Created ${mobs.length} mobs`);
        } else {
            console.warn('Mobs sprite sheet not loaded!');
        }
        
        // Load saved game state
        loadGame();
        
        // Auto-save when inventory or tiles change
        const originalInventoryWood = game.inventory.wood;
        const originalPlacedTilesLength = game.placedTiles.length;
        
        // Set up auto-save on changes (will be checked in game loop)
        lastAutoSave = Date.now();
        
        // Hide loading
        loadingEl.classList.add('hidden');
        
        // Start game loop
        gameLoop();
    } catch (error) {
        console.error('Error loading sprite sheets:', error);
        loadingEl.textContent = 'Error loading sprite sheets. Please check the file names.';
    }
}

// Input handling
document.addEventListener('keydown', (e) => {
    game.keys[e.key] = true;
    
    // Toggle scrolling mode (Shift key)
    if (e.key === 'Shift') {
        game.scrollingMode = true;
    }
    
    // Character 1 (Steve) - Arrow keys (only if not scrolling)
    if (!game.scrollingMode) {
        if (e.key === 'ArrowLeft') {
            game.characters[0]?.moveLeft();
        }
        if (e.key === 'ArrowRight') {
            game.characters[0]?.moveRight();
        }
        if (e.key === 'ArrowUp' || e.key === ' ') {
            e.preventDefault();
            game.characters[0]?.jump();
        }
    }
    
    // Character 2 (Alex) - WASD keys (only if not scrolling)
    if (!game.scrollingMode) {
        if (e.key === 'a' || e.key === 'A') {
            game.characters[1]?.moveLeft();
        }
        if (e.key === 'd' || e.key === 'D') {
            game.characters[1]?.moveRight();
        }
        if (e.key === 'w' || e.key === 'W') {
            game.characters[1]?.jump();
        }
    }
    
    // Toggle debug mode (show bounding boxes) - Press 'B'
    if (e.key === 'b' || e.key === 'B') {
        game.debugMode = !game.debugMode;
        game.characters.forEach(char => {
            char.showBounds = game.debugMode;
        });
        console.log(`Debug mode: ${game.debugMode ? 'ON' : 'OFF'}`);
    }
    
    // Action key (E) - Start mining nearest tree (held down for continuous mining)
    if (e.key === 'e' || e.key === 'E') {
        const steve = game.characters[0]; // Steve is the first character
        if (!steve) return;
        
        // Find the nearest tree to Steve
        let nearestTree = null;
        let nearestDistance = Infinity;
        let nearestTreeIndex = -1;
        
        for (let i = 0; i < game.trees.length; i++) {
            const tree = game.trees[i];
            if (steve.isNearTree(tree)) {
                const steveWorldBounds = steve.getWorldBounds();
                const steveCenterX = steveWorldBounds.x + steveWorldBounds.width / 2;
                const steveCenterY = steveWorldBounds.y + steveWorldBounds.height / 2;
                const treeWorldBounds = tree.getWorldBounds();
                const treeCenterX = treeWorldBounds.x + treeWorldBounds.width / 2;
                const treeCenterY = treeWorldBounds.y + treeWorldBounds.height / 2;
                
                const dx = steveCenterX - treeCenterX;
                const dy = steveCenterY - treeCenterY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestTree = tree;
                    nearestTreeIndex = i;
                }
            }
        }
        
        if (nearestTree) {
            // Start mining - set state and track target tree
            game.mining.isMining = true;
            game.mining.targetTreeIndex = nearestTreeIndex;
            game.mining.lastHitTime = Date.now();
            steve.state = 'mine';
        } else {
            console.log('No tree nearby. Get closer to a tree and press E to chop it.');
        }
    }
    
    // Toggle inventory display (I key)
    if (e.key === 'i' || e.key === 'I') {
        game.showInventory = !game.showInventory;
    }
    
    // Toggle material palette (P key)
    if (e.key === 'p' || e.key === 'P') {
        game.showMaterialPalette = !game.showMaterialPalette;
        if (!game.showMaterialPalette) {
            game.selectedMaterial = null;
            game.placementMode = false;
        }
    }
    
    // Number keys 1-9 to select materials from palette
    const numKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    if (numKeys.includes(e.key) && game.showMaterialPalette) {
        const materialOrder = ['dirt', 'wood', 'clay', 'stone', 'iron', 'silver', 'gold', 'sand', 'snow'];
        const index = parseInt(e.key) - 1;
        if (index < materialOrder.length) {
            const materialName = materialOrder[index];
            // Check if player has this material in inventory
            const count = game.inventory[materialName] || 0;
            if (count > 0) {
                game.selectedMaterial = materialName;
                game.placementMode = true;
                console.log(`Selected ${materialName} for placement`);
            } else {
                console.log(`You don't have any ${materialName}`);
            }
        }
    }
    
    // Escape to cancel placement mode
    if (e.key === 'Escape') {
        game.selectedMaterial = null;
        game.placementMode = false;
    }
});

document.addEventListener('keyup', (e) => {
    game.keys[e.key] = false;
    
    // Toggle scrolling mode off
    if (e.key === 'Shift') {
        game.scrollingMode = false;
    }
    
    // Stop character 1
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        game.characters[0]?.stop();
    }
    
    // Stop character 2
    if (e.key === 'a' || e.key === 'A' || e.key === 'd' || e.key === 'D') {
        game.characters[1]?.stop();
    }
    
    // Stop mining when E is released
    if (e.key === 'e' || e.key === 'E') {
        const steve = game.characters[0];
        if (steve && game.mining.isMining) {
            game.mining.isMining = false;
            game.mining.targetTreeIndex = -1;
            if (steve.state === 'mine') {
                steve.state = 'idle';
            }
        }
    }
});

// Draw inventory UI
function drawInventory(ctx) {
    if (!game.showInventory) return;
    
    const invX = 10;
    const invY = 10;
    const slotSize = 64; // Size of each inventory slot (increased to accommodate wider sprites)
    const slotPadding = 8; // Padding between slots
    const slotsPerRow = 4; // Number of slots per row
    
    // Get inventory sprite sheet
    const inventorySheet = game.spriteSheets['inventory'];
    if (!inventorySheet) {
        // Fallback: draw text-only inventory if sprite sheet not loaded
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(invX, invY, 250, 100);
        ctx.fillStyle = '#fff';
        ctx.font = '12px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('Inventory loading...', invX + 5, invY + 20);
        return;
    }
    
    // Material value order (higher number = more valuable, sorted ascending - lowest to highest)
    const materialValue = {
        'gold': 9,
        'silver': 8,
        'iron': 7,
        'stone': 6,
        'clay': 5,
        'wood': 4,
        'dirt': 3,
        'sand': 2,
        'snow': 1
    };
    
    // Build list of items to display (only items that have been obtained)
    const itemsToShow = [];
    
    // Add all inventory items (only if they have been obtained - count > 0)
    if (game.inventoryMappings) {
        const allItems = [
            { name: 'snow', displayName: 'Snow' },
            { name: 'sand', displayName: 'Sand' },
            { name: 'dirt', displayName: 'Dirt' },
            { name: 'wood', displayName: 'Wood' },
            { name: 'clay', displayName: 'Clay' },
            { name: 'stone', displayName: 'Stone' },
            { name: 'iron', displayName: 'Iron' },
            { name: 'silver', displayName: 'Silver' },
            { name: 'gold', displayName: 'Gold' }
        ];
        
        allItems.forEach(item => {
            const frameIndex = game.inventoryMappings[item.name];
            const count = game.inventory[item.name] || 0;
            
            // Only show item if it has been obtained (count > 0) and has a valid frame mapping
            if (count > 0 && frameIndex !== null && frameIndex !== undefined) {
                itemsToShow.push({
                    name: item.name,
                    displayName: item.displayName,
                    key: item.name,
                    frameIndex: frameIndex,
                    count: count,
                    value: materialValue[item.name] || 0
                });
            }
        });
    }
    
    // Sort items by value (ascending - lowest to highest)
    itemsToShow.sort((a, b) => {
        // First sort by value (ascending)
        if (a.value !== b.value) {
            return a.value - b.value;
        }
        // If values are equal, sort alphabetically by name
        return a.name.localeCompare(b.name);
    });
    
    // Calculate inventory panel size
    const rows = Math.ceil(itemsToShow.length / slotsPerRow);
    // Add extra width to accommodate wider sprites (164px frame width scaled to slot size)
    const extraWidth = 20; // Additional padding for wider items
    const invWidth = (slotSize + slotPadding) * slotsPerRow + slotPadding + extraWidth;
    const invHeight = 30 + (rows * (slotSize + slotPadding + 20)) + slotPadding; // +20 for text below
    
    // Draw inventory background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(invX, invY, invWidth, invHeight);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(invX, invY, invWidth, invHeight);
    
    // Draw inventory title
    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Inventory (Press I to toggle)', invX + 5, invY + 18);
    
    // Draw inventory slots
    let slotIndex = 0;
    itemsToShow.forEach(item => {
        const row = Math.floor(slotIndex / slotsPerRow);
        const col = slotIndex % slotsPerRow;
        const slotX = invX + slotPadding + col * (slotSize + slotPadding);
        const slotY = invY + 30 + row * (slotSize + slotPadding + 20);
        
        // Draw slot background
        ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
        ctx.fillRect(slotX, slotY, slotSize, slotSize);
        ctx.strokeStyle = 'rgba(200, 200, 200, 0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(slotX, slotY, slotSize, slotSize);
        
        // Draw sprite
        if (item.frameIndex !== null && item.frameIndex !== undefined) {
            const spriteScale = slotSize / inventorySheet.frameWidth;
            inventorySheet.drawFrame(ctx, item.frameIndex, slotX, slotY, spriteScale);
        }
        
        // Draw quantity overlay (bottom-right corner)
        if (item.count > 0) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            const qtyText = item.count.toString();
            ctx.font = 'bold 12px monospace';
            ctx.textAlign = 'right';
            const textX = slotX + slotSize - 2;
            const textY = slotY + slotSize - 2;
            const textWidth = ctx.measureText(qtyText).width;
            ctx.fillRect(textX - textWidth - 4, textY - 14, textWidth + 4, 16);
            ctx.fillStyle = '#fff';
            ctx.fillText(qtyText, textX, textY);
        }
        
        // Draw item name below slot
        ctx.fillStyle = '#fff';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(item.displayName, slotX + slotSize / 2, slotY + slotSize + 14);
        
        slotIndex++;
    });
}

// Spawn trees in a given area (world X range)
function spawnTreesInArea(startX, endX, worldGroundY) {
    if (!game.spriteSheets.trees) return;
    
    // Use actual mappings from config, or fallback to safe frame indices
    const smallTreeFrame = game.treesMappings?.small ?? 3;
    const mediumTreeFrame = game.treesMappings?.medium ?? 7;
    const blossomTreeFrame = game.treesMappings?.blossom1 ?? 10;
    
    const shrub1Frame = game.shrubsMappings?.shrub1 ?? 2;
    const shrub2Frame = game.shrubsMappings?.shrub2 ?? 3;
    const shrub3Frame = game.shrubsMappings?.shrub3 ?? 4;
    
    const treeFrames = [smallTreeFrame, mediumTreeFrame, blossomTreeFrame];
    const shrubFrames = [shrub1Frame, shrub2Frame, shrub3Frame];
    const allFrames = [...treeFrames, ...shrubFrames];
    
    // Chunk size for spawning (spawn trees every 200 pixels)
    const chunkSize = 200;
    const startChunk = Math.floor(startX / chunkSize);
    const endChunk = Math.floor(endX / chunkSize);
    
    // Spawn trees in chunks
    for (let chunkX = startChunk; chunkX <= endChunk; chunkX++) {
        const chunkKey = `chunk_${chunkX}`;
        
        // Skip if this chunk has already been spawned
        if (game.spawnedTreeChunks.has(chunkKey)) {
            continue;
        }
        
        // Mark chunk as spawned
        game.spawnedTreeChunks.add(chunkKey);
        
        // Spawn 2-4 trees per chunk
        const treesPerChunk = 2 + Math.floor(Math.random() * 3);
        const chunkStartX = chunkX * chunkSize;
        const chunkEndX = chunkStartX + chunkSize;
        
        for (let i = 0; i < treesPerChunk; i++) {
            // Random X position within chunk
            const treeX = chunkStartX + Math.random() * chunkSize;
            
            // Randomly choose tree or shrub (70% trees, 30% shrubs)
            const isShrub = Math.random() < 0.3;
            const frameIndex = isShrub 
                ? shrubFrames[Math.floor(Math.random() * shrubFrames.length)]
                : treeFrames[Math.floor(Math.random() * treeFrames.length)];
            
            // Check if there's already a tree too close (minimum 50 pixels apart)
            let tooClose = false;
            for (const existingTree of game.trees) {
                const distance = Math.abs(existingTree.x - treeX);
                if (distance < 50) {
                    tooClose = true;
                    break;
                }
            }
            
            // Also check placed tiles
            if (!tooClose) {
                for (const tile of game.placedTiles) {
                    const tileWorldBounds = tile.getWorldBounds();
                    const distance = Math.abs(tileWorldBounds.x - treeX);
                    if (distance < 50) {
                        tooClose = true;
                        break;
                    }
                }
            }
            
            if (!tooClose) {
                const tree = new Tree(game.spriteSheets.trees, treeX, 0, frameIndex);
                tree.y = tree.getBaseYPosition(worldGroundY);
                
                // Store spawn point for regrowth
                game.treeSpawnPoints.push({
                    x: tree.x,
                    frameIndex: tree.frameIndex
                });
                
                game.trees.push(tree);
            }
        }
    }
}

// Get biome based on world X position
function getBiome(worldX) {
    if (worldX < -1000)        return 'cave';
    if (worldX >= 4000)        return 'snow';
    if (worldX >= 3000)        return 'swamp';
    if (worldX >= 2000)        return 'sand';
    return 'default';
}

// Get biome colors
function getBiomeColors(biome) {
    switch (biome) {
        case 'cave':
            return {
                sky: '#1a1a1a',
                nightSky: '#0a0a0a',
                ground: '#2a2a2a',
                grass: '#3a3a3a'
            };
        case 'sand':
            return {
                sky: '#FFE4B5',
                nightSky: '#0a0820',
                ground: '#D2B48C',
                grass: '#DEB887'
            };
        case 'swamp':
            return {
                sky: '#4a6741',
                nightSky: '#0a1a0a',
                ground: '#3d5c2a',
                grass: '#2d4a1a'
            };
        case 'snow':
            return {
                sky: '#E0E0E0',
                nightSky: '#1a1a2e',
                ground: '#F5F5F5',
                grass: '#E8E8E8'
            };
        default:
            return {
                sky: '#87CEEB',
                nightSky: '#0a0a2e',
                ground: '#8B4513',
                grass: '#228B22'
            };
    }
}

// Save game state to localStorage
function saveGame() {
    try {
        const gameState = {
            inventory: game.inventory,
            placedTiles: game.placedTiles.map(tile => tile.toJSON()),
            camera: game.camera,
            version: 1 // For future compatibility
        };
        localStorage.setItem('minecraff_save', JSON.stringify(gameState));
        console.log('Game saved!');
        return true;
    } catch (error) {
        console.error('Failed to save game:', error);
        return false;
    }
}

// Load game state from localStorage
function loadGame() {
    try {
        const saved = localStorage.getItem('minecraff_save');
        if (!saved) {
            console.log('No saved game found');
            return false;
        }
        
        const gameState = JSON.parse(saved);
        
        // Restore inventory
        if (gameState.inventory) {
            Object.assign(game.inventory, gameState.inventory);
        }
        
        // Don't restore camera position - let it follow Steve naturally
        // Camera will be positioned correctly by the camera follow system in the game loop
        // This prevents issues where camera and characters are out of sync
        
        // Restore placed tiles
        if (gameState.placedTiles && game.spriteSheets['materials']) {
            game.placedTiles = gameState.placedTiles.map(tileData => 
                Tile.fromJSON(tileData, game.spriteSheets['materials'])
            );
            console.log(`Loaded ${game.placedTiles.length} placed tiles`);
        }
        
        console.log('Game loaded!');
        return true;
    } catch (error) {
        console.error('Failed to load game:', error);
        return false;
    }
}

// Lerp between two hex colors by t (0=a, 1=b)
function lerpColor(a, b, t) {
    const ah = parseInt(a.slice(1), 16);
    const bh = parseInt(b.slice(1), 16);
    const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
    const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
    const rr = Math.round(ar + (br - ar) * t);
    const rg = Math.round(ag + (bg - ag) * t);
    const rb = Math.round(ab + (bb - ab) * t);
    return `#${((rr << 16) | (rg << 8) | rb).toString(16).padStart(6, '0')}`;
}

// Pre-generate star positions (deterministic so they don't move frame-to-frame)
const STARS = Array.from({ length: 25 }, (_, i) => ({
    x: ((i * 137 + 53) % 97) / 97,
    y: ((i * 79  + 17) % 61) / 61 * 0.7,
    r: (i % 3 === 0) ? 1.5 : 1
}));

// Auto-save periodically
let lastAutoSave = Date.now();
const AUTO_SAVE_INTERVAL = 30000; // Auto-save every 30 seconds

// Game loop
function gameLoop(timestamp) {
    // Delta time
    if (game.dayNight.lastTimestamp === null) {
        game.dayNight.lastTimestamp = timestamp;
    }
    const deltaMs = timestamp - game.dayNight.lastTimestamp;
    game.dayNight.lastTimestamp = timestamp;

    // Advance day/night cycle
    game.dayNight.elapsed = (game.dayNight.elapsed + deltaMs) % game.dayNight.cycleDuration;
    const cyclePos = game.dayNight.elapsed / game.dayNight.cycleDuration;

    const prevPhase = game.dayNight.phase;
    if (cyclePos < 0.40) {
        game.dayNight.phase = 'DAY';
    } else if (cyclePos < 0.55) {
        game.dayNight.phase = 'EVENING';
    } else if (cyclePos < 0.75) {
        game.dayNight.phase = 'NIGHT';
    } else {
        game.dayNight.phase = 'DAWN';
    }
    const phaseChanged = game.dayNight.phase !== prevPhase;

    // Auto-save periodically
    if (Date.now() - lastAutoSave > AUTO_SAVE_INTERVAL) {
        saveGame();
        lastAutoSave = Date.now();
    }
    
    // Camera follows the active player character (Steve) by default
    // Only allow manual scrolling when Shift is held
    const steve = game.characters[0];
    if (steve && !game.scrollingMode) {
        // Camera follows Steve - center him on screen
        const steveWorldBounds = steve.getWorldBounds();
        const steveCenterX = steveWorldBounds.x + steveWorldBounds.width / 2;
        const steveCenterY = steveWorldBounds.y + steveWorldBounds.height / 2;
        
        // Smooth camera follow (lerp for smoother movement)
        const cameraLerpSpeed = 0.1;
        const targetCameraX = steveCenterX - canvas.width / 2;
        const targetCameraY = steveCenterY - canvas.height / 2;
        
        game.camera.x += (targetCameraX - game.camera.x) * cameraLerpSpeed;
        game.camera.y += (targetCameraY - game.camera.y) * cameraLerpSpeed;
    } else if (game.scrollingMode) {
        // Manual scrolling when Shift is held
        const scrollSpeed = 5;
        if (game.keys['ArrowLeft'] || game.keys['a'] || game.keys['A']) {
            game.camera.x -= scrollSpeed;
        }
        if (game.keys['ArrowRight'] || game.keys['d'] || game.keys['D']) {
            game.camera.x += scrollSpeed;
        }
        if (game.keys['ArrowUp'] || game.keys['w'] || game.keys['W']) {
            game.camera.y -= scrollSpeed;
        }
        if (game.keys['ArrowDown'] || game.keys['s'] || game.keys['S']) {
            game.camera.y += scrollSpeed;
        }
    }
    
    // Spawn trees in areas around the camera (procedural generation)
    if (game.spriteSheets.trees) {
        const worldGroundY = canvas.height - 50;
        const cameraCenterX = game.camera.x + canvas.width / 2;
        // Spawn trees in a wider area around the camera (3 screen widths ahead and behind)
        const spawnRange = canvas.width * 3;
        const spawnStartX = cameraCenterX - spawnRange;
        const spawnEndX = cameraCenterX + spawnRange;
        spawnTreesInArea(spawnStartX, spawnEndX, worldGroundY);
    }
    
    // Get current biome based on camera position
    const currentBiome = getBiome(game.camera.x + canvas.width / 2);
    const biomeColors = getBiomeColors(currentBiome);

    // Compute sky color based on day/night phase
    const SUNSET_COLOR = '#e85d3a';
    let skyColor;
    if (cyclePos < 0.40) {
        skyColor = biomeColors.sky;
    } else if (cyclePos < 0.55) {
        const t = (cyclePos - 0.40) / 0.15;
        skyColor = t < 0.5
            ? lerpColor(biomeColors.sky, SUNSET_COLOR, t * 2)
            : lerpColor(SUNSET_COLOR, biomeColors.nightSky, (t - 0.5) * 2);
    } else if (cyclePos < 0.75) {
        skyColor = biomeColors.nightSky;
    } else {
        const t = (cyclePos - 0.75) / 0.25;
        skyColor = t < 0.5
            ? lerpColor(biomeColors.nightSky, SUNSET_COLOR, t * 2)
            : lerpColor(SUNSET_COLOR, biomeColors.sky, (t - 0.5) * 2);
    }

    ctx.fillStyle = skyColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Stars and moon fade in during evening, stay through night, fade out at dawn
    const starAlpha = cyclePos >= 0.55 && cyclePos < 0.75 ? 1.0
        : cyclePos >= 0.40 && cyclePos < 0.55 ? (cyclePos - 0.40) / 0.15
        : cyclePos >= 0.75 && cyclePos < 0.875 ? 1.0 - (cyclePos - 0.75) / 0.125
        : 0;

    if (starAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = starAlpha;
        ctx.fillStyle = '#ffffff';
        for (const star of STARS) {
            ctx.beginPath();
            ctx.arc(star.x * canvas.width, star.y * canvas.height * 0.8, star.r, 0, Math.PI * 2);
            ctx.fill();
        }
        // Moon: glowing circle top-right
        ctx.shadowColor = '#fffde7';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#fffde7';
        ctx.beginPath();
        ctx.arc(canvas.width - 60, 40, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
    }
    
    // Draw ground with biome colors
    // Ground is at fixed world Y position, convert to screen coordinates
    const worldGroundY = canvas.height - 50; // Fixed world ground Y position
    const screenGroundY = worldGroundY - game.camera.y; // Convert to screen coordinates
    
    // Draw ground across the visible viewport (extend beyond viewport if needed)
    // Draw from left edge of viewport to right edge, accounting for camera X
    const groundStartX = -game.camera.x % 100; // Offset for seamless tiling if we add texture later
    ctx.fillStyle = biomeColors.ground;
    ctx.fillRect(0, screenGroundY, canvas.width, 50);
    ctx.fillStyle = biomeColors.grass;
    ctx.fillRect(0, screenGroundY, canvas.width, 10);
    
    // Check for trees that should regrow
    const currentTime = Date.now();
    for (let i = game.treeRegrowthQueue.length - 1; i >= 0; i--) {
        const regrowth = game.treeRegrowthQueue[i];
        if (currentTime >= regrowth.regrowAt) {
            // Check if there's already a tree at this position (or very close)
            const minDistance = 50; // Minimum distance between trees
            let canRegrow = true;
            for (const existingTree of game.trees) {
                const existingWorldBounds = existingTree.getWorldBounds();
                const distance = Math.abs(existingWorldBounds.x - regrowth.x);
                if (distance < minDistance) {
                    canRegrow = false;
                    break;
                }
            }
            
            // Also check if any character is too close
            if (canRegrow) {
                for (const character of game.characters) {
                    const charWorldBounds = character.getWorldBounds();
                    const distance = Math.abs(charWorldBounds.x - regrowth.x);
                    if (distance < 100) { // Don't regrow if character is too close
                        canRegrow = false;
                        break;
                    }
                }
            }
            
            if (canRegrow && game.spriteSheets.trees) {
                // Regrow the tree at world position
                const newTree = new Tree(game.spriteSheets.trees, regrowth.x, 0, regrowth.frameIndex);
                // Use world ground Y (same as initial tree positioning)
                const worldGroundY = canvas.height - 50;
                newTree.y = newTree.getBaseYPosition(worldGroundY);
                game.trees.push(newTree);
                console.log(`Tree regrew at world x=${regrowth.x}`);
            }
            
            // Remove from regrowth queue
            game.treeRegrowthQueue.splice(i, 1);
        }
    }
    
    // Find the nearest tree to Steve (for showing interaction hint)
    let nearestTreeIndex = -1;
    let nearestDistance = Infinity;
    if (steve) {
        for (let i = 0; i < game.trees.length; i++) {
            const tree = game.trees[i];
            if (steve.isNearTree(tree)) {
                const steveWorldBounds = steve.getWorldBounds();
                const steveCenterX = steveWorldBounds.x + steveWorldBounds.width / 2;
                const steveCenterY = steveWorldBounds.y + steveWorldBounds.height / 2;
                const treeWorldBounds = tree.getWorldBounds();
                const treeCenterX = treeWorldBounds.x + treeWorldBounds.width / 2;
                const treeCenterY = treeWorldBounds.y + treeWorldBounds.height / 2;
                
                const dx = steveCenterX - treeCenterX;
                const dy = steveCenterY - treeCenterY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestTreeIndex = i;
                }
            }
        }
    }
    
    // Draw placed tiles (before trees, so trees appear on top)
    // Only draw tiles that are visible in the viewport
    game.placedTiles.forEach(tile => {
        const worldBounds = tile.getWorldBounds();
        // Check if tile is in viewport
        if (worldBounds.x + worldBounds.width >= game.camera.x &&
            worldBounds.x <= game.camera.x + canvas.width &&
            worldBounds.y + worldBounds.height >= game.camera.y &&
            worldBounds.y <= game.camera.y + canvas.height) {
            tile.draw(ctx, game.camera.x, game.camera.y);
        }
    });
    
    // Update and draw mobs (before chickens, so they appear below)
    game.mobs.forEach(mob => {
        mob.update();
        const mobWorldBounds = mob.getWorldBounds();
        // Only draw if mob is in viewport
        if (mobWorldBounds.x + mobWorldBounds.width >= game.camera.x &&
            mobWorldBounds.x <= game.camera.x + canvas.width &&
            mobWorldBounds.y + mobWorldBounds.height >= game.camera.y &&
            mobWorldBounds.y <= game.camera.y + canvas.height) {
            mob.draw(ctx, game.camera.x, game.camera.y);
        }
        
        // Draw bounding boxes in debug mode
        if (game.debugMode) {
            const bounds = mob.getBounds(game.camera.x, game.camera.y);
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.lineWidth = 2;
            ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
            
            // Draw mob type label
            ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.font = '10px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(mob.mobType, bounds.x, bounds.y - 5);
        }
    });
    
    // Update and draw chickens (before trees, so trees appear on top)
    game.chickens.forEach(chicken => {
        chicken.update();
        const chickenWorldBounds = chicken.getWorldBounds();
        // Only draw if chicken is in viewport
        if (chickenWorldBounds.x + chickenWorldBounds.width >= game.camera.x &&
            chickenWorldBounds.x <= game.camera.x + canvas.width &&
            chickenWorldBounds.y + chickenWorldBounds.height >= game.camera.y &&
            chickenWorldBounds.y <= game.camera.y + canvas.height) {
            chicken.draw(ctx, game.camera.x, game.camera.y);
        }
        
        // Draw bounding boxes in debug mode
        if (game.debugMode) {
            const bounds = chicken.getBounds(game.camera.x, game.camera.y);
            ctx.strokeStyle = 'rgba(255, 200, 0, 0.8)';
            ctx.lineWidth = 2;
            ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
        }
    });
    
    // Draw trees (only those in viewport)
    game.trees.forEach((tree, index) => {
        const treeWorldBounds = tree.getWorldBounds();
        // Check if tree is in viewport
        if (treeWorldBounds.x + treeWorldBounds.width >= game.camera.x &&
            treeWorldBounds.x <= game.camera.x + canvas.width &&
            treeWorldBounds.y + treeWorldBounds.height >= game.camera.y &&
            treeWorldBounds.y <= game.camera.y + canvas.height) {
            tree.draw(ctx, game.camera.x, game.camera.y);
        }
        
        // Check if any character is near this tree (for debug mode)
        let isCharacterNear = false;
        game.characters.forEach(character => {
            if (character.isNearTree(tree)) {
                isCharacterNear = true;
            }
        });
        
        // Debug: draw tree bounds and interaction range in debug mode
        if (game.debugMode) {
            const bounds = tree.getBounds(game.camera.x, game.camera.y);
            ctx.strokeStyle = 'rgba(255, 165, 0, 0.8)';
            ctx.lineWidth = 2;
            ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
            
            // Draw interaction range circle
            const centerX = bounds.x + bounds.width / 2;
            const centerY = bounds.y + bounds.height / 2;
            ctx.beginPath();
            ctx.arc(centerX, centerY, 120, 0, Math.PI * 2);
            ctx.strokeStyle = isCharacterNear ? 'rgba(0, 255, 0, 0.5)' : 'rgba(255, 255, 0, 0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            // Draw frame index label
            ctx.fillStyle = 'rgba(255, 165, 0, 0.8)';
            ctx.font = '10px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`Tree ${index} (frame ${tree.frameIndex}, health: ${tree.health})`, bounds.x, bounds.y - 5);
        }
        
        // Show interaction hint only on the nearest tree to Steve
        if (index === nearestTreeIndex && steve) {
            const bounds = tree.getBounds(game.camera.x, game.camera.y);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.font = '12px monospace';
            ctx.textAlign = 'center';
            const textX = bounds.x + bounds.width / 2;
            const textY = bounds.y - 20;
            ctx.strokeText('Press E to chop', textX, textY);
            ctx.fillText('Press E to chop', textX, textY);
        }
    });
    
    // Update and draw particles (after trees, before characters)
    for (let i = game.particles.length - 1; i >= 0; i--) {
        const particle = game.particles[i];
        particle.update();
        // Pass camera offset to convert world coordinates to screen coordinates
        particle.draw(ctx, game.camera.x, game.camera.y);
        
        // Remove dead particles
        if (particle.isDead()) {
            game.particles.splice(i, 1);
        }
    }
    
    // Handle continuous mining
    const isEPressed = game.keys['e'] || game.keys['E'];
    
    // If E is pressed but we're not mining, try to start mining
    if (isEPressed && !game.mining.isMining && steve) {
        // Find the nearest tree to Steve
        let nearestTree = null;
        let nearestDistance = Infinity;
        let nearestTreeIndex = -1;
        
        for (let i = 0; i < game.trees.length; i++) {
            const tree = game.trees[i];
            if (steve.isNearTree(tree)) {
                const steveWorldBounds = steve.getWorldBounds();
                const steveCenterX = steveWorldBounds.x + steveWorldBounds.width / 2;
                const steveCenterY = steveWorldBounds.y + steveWorldBounds.height / 2;
                const treeWorldBounds = tree.getWorldBounds();
                const treeCenterX = treeWorldBounds.x + treeWorldBounds.width / 2;
                const treeCenterY = treeWorldBounds.y + treeWorldBounds.height / 2;
                
                const dx = steveCenterX - treeCenterX;
                const dy = steveCenterY - treeCenterY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestTree = tree;
                    nearestTreeIndex = i;
                }
            }
        }
        
        if (nearestTree) {
            // Start mining - set state and track target tree
            game.mining.isMining = true;
            game.mining.targetTreeIndex = nearestTreeIndex;
            game.mining.lastHitTime = Date.now();
            steve.state = 'mine';
        }
    }
    
    // Continue mining if E is held and we have a target
    if (game.mining.isMining && game.mining.targetTreeIndex >= 0 && isEPressed) {
        const targetTreeIndex = game.mining.targetTreeIndex;
        
        // Check if target tree still exists and Steve is still near it
        if (targetTreeIndex < game.trees.length && steve) {
            const targetTree = game.trees[targetTreeIndex];
            
            if (steve.isNearTree(targetTree)) {
                // Check if enough time has passed since last hit
                const currentTime = Date.now();
                if (currentTime - game.mining.lastHitTime >= game.mining.hitInterval) {
                    // Calculate hit position (where Steve's axe meets the tree)
                    const steveWorldBounds = steve.getWorldBounds();
                    const treeWorldBounds = targetTree.getWorldBounds();
                    
                    // Hit position is at the intersection between Steve and tree (world coordinates)
                    let hitX, hitY;
                    if (steve.facing === 'right') {
                        // Steve facing right, hitting left side of tree
                        hitX = treeWorldBounds.x;
                        hitY = steveWorldBounds.y + steveWorldBounds.height * 0.4; // Middle-upper part of character
                    } else {
                        // Steve facing left, hitting right side of tree
                        hitX = treeWorldBounds.x + treeWorldBounds.width;
                        hitY = steveWorldBounds.y + steveWorldBounds.height * 0.4;
                    }
                    
                    // Create spark particles at hit location
                    const sparkCount = 6 + Math.floor(Math.random() * 4); // 6-9 sparks
                    for (let i = 0; i < sparkCount; i++) {
                        const spark = new SparkParticle(hitX, hitY);
                        game.particles.push(spark);
                    }
                    
                    // Hit the tree
                    const treeDestroyed = targetTree.hit();
                    if (treeDestroyed) {
                        // Tree destroyed - create wood particle explosion
                        const destroyedTreeWorldBounds = targetTree.getWorldBounds();
                        const treeCenterX = destroyedTreeWorldBounds.x + destroyedTreeWorldBounds.width / 2;
                        const treeCenterY = destroyedTreeWorldBounds.y + destroyedTreeWorldBounds.height / 2;
                        
                        // Get wood sprite frame index
                        const woodFrameIndex = (game.inventoryMappings && game.inventoryMappings.wood !== null && game.inventoryMappings.wood !== undefined) 
                            ? game.inventoryMappings.wood 
                            : 0;
                        
                        // Create 5-8 wood particles exploding from tree center
                        const particleCount = 5 + Math.floor(Math.random() * 4);
                        const inventorySheet = game.spriteSheets['inventory'];
                        if (inventorySheet) {
                            for (let i = 0; i < particleCount; i++) {
                                const particle = new WoodParticle(
                                    inventorySheet,
                                    woodFrameIndex,
                                    treeCenterX,
                                    treeCenterY
                                );
                                game.particles.push(particle);
                            }
                        }
                        
                        // Tree destroyed - add wood to inventory
                        game.inventory.wood += 1;
                        console.log(`Chopped down tree! Wood: ${game.inventory.wood}`);
                        
                        // Store tree info for regrowth before removing
                        const destroyedTree = targetTree;
                        
                        // Schedule tree regrowth (random delay between 10-30 seconds)
                        const regrowthDelay = 10000 + Math.random() * 20000; // 10-30 seconds
                        game.treeRegrowthQueue.push({
                            x: destroyedTreeWorldBounds.x,
                            frameIndex: destroyedTree.frameIndex,
                            regrowAt: Date.now() + regrowthDelay
                        });
                        
                        // Remove tree
                        game.trees.splice(targetTreeIndex, 1);
                        // Stop mining
                        game.mining.isMining = false;
                        game.mining.targetTreeIndex = -1;
                        // Return to idle after a brief delay
                        setTimeout(() => {
                            if (steve.state === 'mine') {
                                steve.state = 'idle';
                            }
                        }, 300);
                    } else {
                        console.log(`Chopping tree... (${targetTree.health}/${targetTree.maxHealth} hits remaining)`);
                        game.mining.lastHitTime = currentTime;
                    }
                }
            } else {
                // Steve moved away from tree, stop mining
                game.mining.isMining = false;
                game.mining.targetTreeIndex = -1;
                if (steve.state === 'mine') {
                    steve.state = 'idle';
                }
            }
        } else {
            // Tree was removed or invalid index, stop mining
            game.mining.isMining = false;
            game.mining.targetTreeIndex = -1;
            if (steve && steve.state === 'mine') {
                steve.state = 'idle';
            }
        }
    } else if (!isEPressed && game.mining.isMining) {
        // E key released, stop mining
        game.mining.isMining = false;
        game.mining.targetTreeIndex = -1;
        if (steve && steve.state === 'mine') {
            steve.state = 'idle';
        }
    }
    
    // Update and draw characters
    game.characters.forEach(character => {
        character.update();
        character.draw(ctx, game.camera.x, game.camera.y);
        
        // Draw bounding boxes in debug mode
        if (game.debugMode) {
            const bounds = character.getCurrentBounds(game.camera.x, game.camera.y);
            ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
            ctx.lineWidth = 2;
            ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
            
            // Draw corner markers
            ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
            const cornerSize = 4;
            ctx.fillRect(bounds.x - cornerSize/2, bounds.y - cornerSize/2, cornerSize, cornerSize);
            ctx.fillRect(bounds.x + bounds.width - cornerSize/2, bounds.y - cornerSize/2, cornerSize, cornerSize);
            ctx.fillRect(bounds.x - cornerSize/2, bounds.y + bounds.height - cornerSize/2, cornerSize, cornerSize);
            ctx.fillRect(bounds.x + bounds.width - cornerSize/2, bounds.y + bounds.height - cornerSize/2, cornerSize, cornerSize);
        }
    });
    
    // Draw inventory UI
    drawInventory(ctx);
    
    // Draw material palette UI
    drawMaterialPalette(ctx);
    
    // Draw placement preview cursor if in placement mode
    if (game.placementMode && game.selectedMaterial && game.materialsMappings && game.spriteSheets['materials']) {
        const materialsSheet = game.spriteSheets['materials'];
        const frameIndex = game.materialsMappings[game.selectedMaterial];
        if (frameIndex !== null && frameIndex !== undefined) {
            // Convert screen coordinates to world coordinates
            const worldX = mouseX + game.camera.x;
            const worldY = mouseY + game.camera.y;
            
            // Calculate tile grid position (snap to grid) in world coordinates
            const tileSize = 32; // Match tile size used in Tile class
            const worldGridX = Math.floor(worldX / tileSize) * tileSize;
            const worldGridY = Math.floor(worldY / tileSize) * tileSize;
            
            // Convert back to screen coordinates for drawing
            const screenGridX = worldGridX - game.camera.x;
            const screenGridY = worldGridY - game.camera.y;
            
            // Draw preview with transparency
            ctx.save();
            ctx.globalAlpha = 0.5;
            const scale = tileSize / materialsSheet.frameWidth;
            materialsSheet.drawFrame(ctx, frameIndex, screenGridX, screenGridY, scale);
            ctx.restore();
            
            // Draw grid outline
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 1;
            ctx.strokeRect(screenGridX, screenGridY, tileSize, tileSize);
        }
    }
    
    requestAnimationFrame(gameLoop);
}

// Draw material palette UI
function drawMaterialPalette(ctx) {
    if (!game.showMaterialPalette) return;
    
    const materialsSheet = game.spriteSheets['materials'];
    if (!materialsSheet) return;
    
    const paletteX = canvas.width - 200;
    const paletteY = 10;
    const slotSize = 48;
    const slotPadding = 4;
    const slotsPerRow = 3;
    
    const materials = [
        { name: 'dirt', displayName: 'Dirt', key: '1' },
        { name: 'wood', displayName: 'Wood', key: '2' },
        { name: 'clay', displayName: 'Clay', key: '3' },
        { name: 'stone', displayName: 'Stone', key: '4' },
        { name: 'iron', displayName: 'Iron', key: '5' },
        { name: 'silver', displayName: 'Silver', key: '6' },
        { name: 'gold', displayName: 'Gold', key: '7' },
        { name: 'sand', displayName: 'Sand', key: '8' },
        { name: 'snow', displayName: 'Snow', key: '9' }
    ];
    
    const rows = Math.ceil(materials.length / slotsPerRow);
    const paletteWidth = (slotSize + slotPadding) * slotsPerRow + slotPadding;
    const paletteHeight = 30 + (rows * (slotSize + slotPadding + 15)) + slotPadding;
    
    // Draw palette background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(paletteX, paletteY, paletteWidth, paletteHeight);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(paletteX, paletteY, paletteWidth, paletteHeight);
    
    // Draw palette title
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Materials (Press P to toggle)', paletteX + 5, paletteY + 16);
    
    // Draw material slots
    materials.forEach((material, index) => {
        const row = Math.floor(index / slotsPerRow);
        const col = index % slotsPerRow;
        const slotX = paletteX + slotPadding + col * (slotSize + slotPadding);
        const slotY = paletteY + 25 + row * (slotSize + slotPadding + 15);
        
        const frameIndex = game.materialsMappings[material.name];
        const count = game.inventory[material.name] || 0;
        const isSelected = game.selectedMaterial === material.name;
        
        // Draw slot background
        if (isSelected) {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.5)';
        } else if (count > 0) {
            ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
        } else {
            ctx.fillStyle = 'rgba(50, 50, 50, 0.5)';
        }
        ctx.fillRect(slotX, slotY, slotSize, slotSize);
        
        // Draw border
        ctx.strokeStyle = isSelected ? 'rgba(255, 255, 0, 0.8)' : 'rgba(200, 200, 200, 0.8)';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(slotX, slotY, slotSize, slotSize);
        
        // Draw material sprite
        if (frameIndex !== null && frameIndex !== undefined) {
            const spriteScale = slotSize / materialsSheet.frameWidth;
            ctx.globalAlpha = count > 0 ? 1.0 : 0.3; // Dim if not available
            materialsSheet.drawFrame(ctx, frameIndex, slotX, slotY, spriteScale);
            ctx.globalAlpha = 1.0;
        }
        
        // Draw key label (top-left)
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(material.key, slotX + 2, slotY + 12);
        
        // Draw count (bottom-right)
        if (count > 0) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            const qtyText = count.toString();
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'right';
            const textX = slotX + slotSize - 2;
            const textY = slotY + slotSize - 2;
            const textWidth = ctx.measureText(qtyText).width;
            ctx.fillRect(textX - textWidth - 2, textY - 10, textWidth + 2, 12);
            ctx.fillStyle = '#fff';
            ctx.fillText(qtyText, textX, textY);
        }
        
        // Draw material name below slot
        ctx.fillStyle = count > 0 ? '#fff' : '#888';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(material.displayName, slotX + slotSize / 2, slotY + slotSize + 11);
    });
}

// Handle mouse clicks for tile placement
canvas.addEventListener('click', (e) => {
    if (!game.placementMode || !game.selectedMaterial || !game.materialsMappings) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if click is within game area (not on UI)
    if (x < 10 || y < 10) return; // Avoid clicking on UI elements
    
    // Check if player has the material
    const count = game.inventory[game.selectedMaterial] || 0;
    if (count <= 0) {
        console.log(`You don't have any ${game.selectedMaterial}`);
        return;
    }
    
    // Get materials sprite sheet
    const materialsSheet = game.spriteSheets['materials'];
    if (!materialsSheet) return;
    
    const frameIndex = game.materialsMappings[game.selectedMaterial];
    if (frameIndex === null || frameIndex === undefined) return;
    
    // Convert screen coordinates to world coordinates
    const worldX = x + game.camera.x;
    const worldY = y + game.camera.y;
    
    // Calculate tile grid position (snap to grid) in world coordinates
    const tileSize = 32; // Size of tiles in game world (match Tile class)
    const gridX = Math.floor(worldX / tileSize) * tileSize;
    const gridY = Math.floor(worldY / tileSize) * tileSize;
    
    // Check if there's already a tile at this position (world coordinates)
    const existingTile = game.placedTiles.find(tile => {
        const worldBounds = tile.getWorldBounds();
        return worldBounds.x === gridX && worldBounds.y === gridY;
    });
    
    if (existingTile) {
        // Remove existing tile (replace)
        const index = game.placedTiles.indexOf(existingTile);
        game.placedTiles.splice(index, 1);
    }
    
    // Create new tile
    const newTile = new Tile(materialsSheet, gridX, gridY, frameIndex, game.selectedMaterial);
    game.placedTiles.push(newTile);
    
    // Deduct material from inventory
    game.inventory[game.selectedMaterial]--;
    
    // Auto-save after placing tile
    saveGame();
    
    console.log(`Placed ${game.selectedMaterial} at world (${gridX}, ${gridY})`);
});

// Handle mouse move for placement preview
let mouseX = 0;
let mouseY = 0;
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
});

// Start the game
initGame();

