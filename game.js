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
    particles: [], // Particle effects (e.g., wood sprites exploding from trees)
    inventory: {
        wood: 0,
        dirt: 0,
        stone: 0,
        clay: 0,
        gold: 0,
        iron: 0,
        silver: 0,
        items: []
    },
    inventoryMappings: null, // Frame mappings for inventory items (from config)
    treesMappings: null, // Frame mappings for trees (from config)
    shrubsMappings: null, // Frame mappings for shrubs (from config)
    showInventory: false, // Press 'I' to toggle inventory display
    debugMode: false, // Press 'D' to toggle debug mode (show bounding boxes)
    mining: {
        isMining: false,
        targetTreeIndex: -1,
        lastHitTime: 0,
        hitInterval: 500 // Milliseconds between hits
    }
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
    getCurrentBounds() {
        const animFrames = this.animations[this.state] || this.animations.idle;
        const frameIndex = animFrames[this.currentFrame] || 0;
        const frameBounds = this.spriteSheet.frameBounds[frameIndex];
        
        // If bounds not yet analyzed, return full frame bounds
        if (!frameBounds) {
            return {
                x: this.x,
                y: this.y,
                width: this.width,
                height: this.height
            };
        }
        
        // Convert frame-relative bounds to world coordinates
        const bounds = {
            x: this.x + (frameBounds.offsetX * this.scale),
            y: this.y + (frameBounds.offsetY * this.scale),
            width: frameBounds.width * this.scale,
            height: frameBounds.height * this.scale
        };
        
        // Account for horizontal flip
        if (this.facing === 'left') {
            bounds.x = this.x + this.width - (frameBounds.offsetX + frameBounds.width) * this.scale;
        }
        
        return bounds;
    }

    update() {
        // Apply gravity
        if (!this.onGround) {
            this.velocityY += this.gravity;
        } else {
            this.velocityY = 0;
        }
        
        // Update position
        this.x += this.velocityX;
        this.y += this.velocityY;
        
        // Ground collision - position based on actual sprite bottom (feet)
        const groundY = canvas.height - 50;
        
        // Calculate current feet position
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
        
        // If character's feet are at or below ground, snap to ground
        if (currentFeetY >= groundY) {
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
                    this.y = groundY - (steveSpriteBottom * this.scale);
                } else {
                    this.y = this.getFeetYPosition(groundY);
                }
            } else {
                this.y = this.getFeetYPosition(groundY);
            }
            this.onGround = true;
            this.velocityY = 0;
        } else {
            this.onGround = false;
        }
        
        // Boundary collision
        if (this.x < 0) this.x = 0;
        if (this.x + this.width > canvas.width) this.x = canvas.width - this.width;
        
        // Update animation
        this.frameCounter++;
        if (this.frameCounter >= this.animationSpeed) {
            this.frameCounter = 0;
            const animFrames = this.animations[this.state] || this.animations.idle;
            this.currentFrame = (this.currentFrame + 1) % animFrames.length;
        }
    }

    draw(ctx) {
        ctx.save();
        
        // Flip horizontally if facing left
        if (this.facing === 'left') {
            ctx.scale(-1, 1);
            ctx.translate(-canvas.width, 0);
            const animFrames = this.animations[this.state] || this.animations.idle;
            const frameIndex = animFrames[this.currentFrame] || 0;
            this.spriteSheet.drawFrame(ctx, frameIndex, canvas.width - this.x - this.width, this.y, this.scale);
        } else {
            const animFrames = this.animations[this.state] || this.animations.idle;
            const frameIndex = animFrames[this.currentFrame] || 0;
            this.spriteSheet.drawFrame(ctx, frameIndex, this.x, this.y, this.scale);
        }
        
        ctx.restore();
        
        // Draw name label (always centered on character, regardless of facing direction)
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        const textX = this.x + this.width / 2;
        ctx.strokeText(this.name, textX, this.y - 10);
        ctx.fillText(this.name, textX, this.y - 10);
    }

    moveLeft() {
        this.velocityX = -this.speed;
        this.facing = 'left';
        // Stop mining if moving
        if (this.state === 'mine') {
            game.mining.isMining = false;
            game.mining.targetTreeIndex = -1;
            this.state = this.onGround ? 'walk' : 'jump';
        } else {
            this.state = this.onGround ? 'walk' : 'jump';
        }
    }

    moveRight() {
        this.velocityX = this.speed;
        this.facing = 'right';
        // Stop mining if moving
        if (this.state === 'mine') {
            game.mining.isMining = false;
            game.mining.targetTreeIndex = -1;
            this.state = this.onGround ? 'walk' : 'jump';
        } else {
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
        if (this.onGround) {
            this.velocityY = this.jumpPower;
            this.onGround = false;
            this.state = 'jump';
        }
    }
    
    // Check if character is near a tree (for interaction)
    isNearTree(tree, range = 120) {
        // Use current bounds for more accurate collision detection
        const bounds = this.getCurrentBounds();
        const charCenterX = bounds.x + bounds.width / 2;
        const charCenterY = bounds.y + bounds.height / 2;
        const treeBounds = tree.getBounds();
        const treeCenterX = treeBounds.x + treeBounds.width / 2;
        const treeCenterY = treeBounds.y + treeBounds.height / 2;
        
        const dx = charCenterX - treeCenterX;
        const dy = charCenterY - treeCenterY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        return distance < range;
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
        
        // Ground collision
        const groundY = canvas.height - 50;
        if (this.y + this.height > groundY) {
            this.y = groundY - this.height;
            this.velocityY *= -0.3; // Bounce with damping
            this.velocityX *= 0.8; // Friction
            if (Math.abs(this.velocityY) < 0.5) {
                this.velocityY = 0; // Stop bouncing when too slow
            }
        }
    }
    
    draw(ctx) {
        ctx.save();
        
        // Apply alpha
        ctx.globalAlpha = this.alpha;
        
        // Translate to center, rotate, then translate back
        const centerX = this.x + this.width / 2;
        const centerY = this.y + this.height / 2;
        ctx.translate(centerX, centerY);
        ctx.rotate(this.rotation);
        ctx.translate(-centerX, -centerY);
        
        // Draw the wood sprite
        this.spriteSheet.drawFrame(ctx, this.frameIndex, this.x, this.y, this.scale);
        
        ctx.restore();
    }
    
    isDead() {
        const elapsed = Date.now() - this.createdAt;
        return elapsed >= this.maxLifetime || this.alpha <= 0;
    }
}

// Tree Class
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
    
    draw(ctx) {
        // Ensure frame index is valid
        if (this.frameIndex >= 0 && this.frameIndex < this.spriteSheet.totalFrames) {
            this.spriteSheet.drawFrame(ctx, this.frameIndex, this.x, this.y, this.scale);
        } else {
            console.warn(`Invalid frame index ${this.frameIndex} for tree (max: ${this.spriteSheet.totalFrames - 1})`);
            // Draw a placeholder rectangle if frame is invalid
            ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.fillRect(this.x, this.y, this.width, this.height);
        }
    }
    
    getBounds() {
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
            idle: [4],
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
                inventoryConfig?.frameWidth || 163,
                inventoryConfig?.frameHeight || 256,
                inventoryConfig?.cols || 6,
                inventoryConfig?.rows || 1
            ),
            // Load trees and shrubs sprite sheet
            loadSpriteSheet(
                'trees',
                treesConfig?.spriteSheet || 'trees.png',
                treesConfig?.frameWidth || 194,
                treesConfig?.frameHeight || 260,
                treesConfig?.cols || 5,
                treesConfig?.rows || 4
            )
        ];
        
        await Promise.all(loadPromises);
        
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
        const groundY = canvas.height - 50;
        
        const steveChar = new Character(
            'Steve',
            game.spriteSheets.steve,
            100,
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
            steveChar.y = groundY - (steveSpriteBottom * steveChar.scale);
        } else {
            // Fallback to getFeetYPosition method
            steveChar.y = steveChar.getFeetYPosition(groundY);
        }
        game.characters.push(steveChar);
        
        const alexChar = new Character(
            'Alex',
            game.spriteSheets.alex,
            500,
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
            alexChar.y = groundY - (alexSpriteBottom * alexChar.scale);
        } else {
            alexChar.y = alexChar.getFeetYPosition(groundY);
        }
        game.characters.push(alexChar);
        
        // Create trees in the world (after sprite sheets are loaded)
        // Trees should sit on the ground, so their bottom aligns with the top of the ground
        
        // Add some trees at different positions
        // Use mappings from config if available, otherwise use default frame indices
        if (game.spriteSheets.trees) {
            // Use actual mappings from config, or fallback to safe frame indices
            const smallTreeFrame = game.treesMappings?.small ?? 3;
            const mediumTreeFrame = game.treesMappings?.medium ?? 7;
            const blossomTreeFrame = game.treesMappings?.blossom1 ?? 10;
            
            const shrub1Frame = game.shrubsMappings?.shrub1 ?? 2;
            const shrub2Frame = game.shrubsMappings?.shrub2 ?? 3;
            const shrub3Frame = game.shrubsMappings?.shrub3 ?? 4;
            
            // Create trees and position them using frame bounds to account for transparent padding
            const trees = [
                new Tree(game.spriteSheets.trees, 150, 0, smallTreeFrame),   // Near Steve
                new Tree(game.spriteSheets.trees, 250, 0, mediumTreeFrame),  // Near Steve
                new Tree(game.spriteSheets.trees, 450, 0, smallTreeFrame),   // Near Alex
                new Tree(game.spriteSheets.trees, 550, 0, blossomTreeFrame), // Near Alex
                new Tree(game.spriteSheets.trees, 350, 0, mediumTreeFrame), // Between them
                new Tree(game.spriteSheets.trees, 650, 0, smallTreeFrame),   // Further right
                new Tree(game.spriteSheets.trees, 50, 0, mediumTreeFrame),   // Further left
                // Add some shrubs
                new Tree(game.spriteSheets.trees, 180, 0, shrub1Frame),      // Shrub near Steve
                new Tree(game.spriteSheets.trees, 480, 0, shrub2Frame),     // Shrub near Alex
                new Tree(game.spriteSheets.trees, 320, 0, shrub3Frame)      // Shrub between them
            ];
            
            // Position all trees using frame bounds
            trees.forEach((tree, index) => {
                tree.y = tree.getBaseYPosition(groundY);
                const frameBounds = tree.spriteSheet.frameBounds[tree.frameIndex];
                console.log(`Tree ${index} (frame ${tree.frameIndex}) positioned at y=${tree.y}, ground at y=${groundY}, frameBounds:`, frameBounds);
            });
            
            game.trees = trees;
        } else {
            console.warn('Trees sprite sheet not loaded!');
        }
        
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
    
    // Character 1 (Steve) - Arrow keys
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
    
    // Character 2 (Alex) - WASD keys
    if (e.key === 'a' || e.key === 'A') {
        game.characters[1]?.moveLeft();
    }
    if (e.key === 'd' || e.key === 'D') {
        game.characters[1]?.moveRight();
    }
    if (e.key === 'w' || e.key === 'W') {
        game.characters[1]?.jump();
    }
    
    // Toggle debug mode (show bounding boxes) - only if not moving
    if ((e.key === 'd' || e.key === 'D') && !game.keys['a'] && !game.keys['A'] && !game.keys['d'] && !game.keys['D']) {
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
                const steveCenterX = steve.x + steve.width / 2;
                const steveCenterY = steve.y + steve.height / 2;
                const treeBounds = tree.getBounds();
                const treeCenterX = treeBounds.x + treeBounds.width / 2;
                const treeCenterY = treeBounds.y + treeBounds.height / 2;
                
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
});

document.addEventListener('keyup', (e) => {
    game.keys[e.key] = false;
    
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
    
    // Build list of items to display
    const itemsToShow = [];
    
    // Add wood (always show - use mapping if available, otherwise default to frame 0)
    const woodFrameIndex = (game.inventoryMappings && game.inventoryMappings.wood !== null && game.inventoryMappings.wood !== undefined) 
        ? game.inventoryMappings.wood 
        : 0; // Default to frame 0 if no mapping exists
    itemsToShow.push({
        name: 'wood',
        displayName: 'Wood',
        key: 'wood',
        frameIndex: woodFrameIndex,
        count: game.inventory.wood || 0
    });
    
    // Add other inventory items
    if (game.inventoryMappings) {
        const otherItems = [
            { name: 'dirt', displayName: 'Dirt' },
            { name: 'stone', displayName: 'Stone' },
            { name: 'clay', displayName: 'Clay' },
            { name: 'gold', displayName: 'Gold' },
            { name: 'iron', displayName: 'Iron' },
            { name: 'silver', displayName: 'Silver' }
        ];
        
        otherItems.forEach(item => {
            const frameIndex = game.inventoryMappings[item.name];
            const count = game.inventory[item.name] || 0;
            // Show item if it has a valid frame mapping or if we have a count
            if (frameIndex !== null && frameIndex !== undefined) {
                itemsToShow.push({
                    name: item.name,
                    displayName: item.displayName,
                    key: item.name,
                    frameIndex: frameIndex,
                    count: count
                });
            }
        });
    }
    
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

// Game loop
function gameLoop() {
    // Clear canvas
    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw ground
    const groundY = canvas.height - 50;
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(0, groundY, canvas.width, 50);
    ctx.fillStyle = '#228B22';
    ctx.fillRect(0, groundY, canvas.width, 10);
    
    // Find the nearest tree to Steve (for showing interaction hint)
    let nearestTreeIndex = -1;
    let nearestDistance = Infinity;
    const steve = game.characters[0];
    if (steve) {
        for (let i = 0; i < game.trees.length; i++) {
            const tree = game.trees[i];
            if (steve.isNearTree(tree)) {
                const steveCenterX = steve.x + steve.width / 2;
                const steveCenterY = steve.y + steve.height / 2;
                const treeBounds = tree.getBounds();
                const treeCenterX = treeBounds.x + treeBounds.width / 2;
                const treeCenterY = treeBounds.y + treeBounds.height / 2;
                
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
    
    // Draw trees
    game.trees.forEach((tree, index) => {
        tree.draw(ctx);
        
        // Check if any character is near this tree (for debug mode)
        let isCharacterNear = false;
        game.characters.forEach(character => {
            if (character.isNearTree(tree)) {
                isCharacterNear = true;
            }
        });
        
        // Debug: draw tree bounds and interaction range in debug mode
        if (game.debugMode) {
            const bounds = tree.getBounds();
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
            const bounds = tree.getBounds();
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
        particle.draw(ctx);
        
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
                const steveCenterX = steve.x + steve.width / 2;
                const steveCenterY = steve.y + steve.height / 2;
                const treeBounds = tree.getBounds();
                const treeCenterX = treeBounds.x + treeBounds.width / 2;
                const treeCenterY = treeBounds.y + treeBounds.height / 2;
                
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
                    // Hit the tree
                    const treeDestroyed = targetTree.hit();
                    if (treeDestroyed) {
                        // Tree destroyed - create wood particle explosion
                        const treeBounds = targetTree.getBounds();
                        const treeCenterX = treeBounds.x + treeBounds.width / 2;
                        const treeCenterY = treeBounds.y + treeBounds.height / 2;
                        
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
        character.draw(ctx);
        
        // Draw bounding boxes in debug mode
        if (game.debugMode) {
            const bounds = character.getCurrentBounds();
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
    
    requestAnimationFrame(gameLoop);
}

// Start the game
initGame();

