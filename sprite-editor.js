// Sprite Editor State
const editor = {
    currentImage: null,
    frameWidth: 32,
    frameHeight: 32,
    cols: 4,
    rows: 4,
    displayScale: 4,
    selectedFrame: null,
    animations: {
        idle: [0],
        walk: [1],
        jump: [10],
        mine: [8, 9]
    },
    objectMappings: {
        inventory: {
            dirt: null,
            stone: null,
            clay: null,
            wood: null,
            gold: null,
            iron: null,
            silver: null
        },
        shrubs: {
            shrub1: null,
            shrub2: null,
            shrub3: null
        },
        trees: {
            small: null,
            medium: null,
            medium2: null,
            large: null,
            dead: null,
            blossom1: null,
            blossom2: null,
            blossom3: null,
            blossom4: null,
            stump: null
        }
    },
    isInventorySheet: false,
    isTreesSheet: false
};

// DOM Elements
const spriteSelect = document.getElementById('spriteSelect');
const frameWidthInput = document.getElementById('frameWidth');
const frameHeightInput = document.getElementById('frameHeight');
const colsInput = document.getElementById('cols');
const rowsInput = document.getElementById('rows');
const displayScaleInput = document.getElementById('displayScale');
const updateParamsBtn = document.getElementById('updateParams');
const imageInfo = document.getElementById('imageInfo');
const spriteCanvas = document.getElementById('spriteCanvas');
const framesGrid = document.getElementById('framesGrid');
const frameSelector = document.getElementById('frameSelector');
const characterNameInput = document.getElementById('characterName');
const exportJsonBtn = document.getElementById('exportJson');
const copyJsonBtn = document.getElementById('copyJson');
const jsonModal = document.getElementById('jsonModal');
const jsonOutput = document.getElementById('jsonOutput');
const closeModal = document.querySelector('.close');
const closeModalBtn = document.getElementById('closeModal');
const downloadJsonBtn = document.getElementById('downloadJson');

// Animation frame inputs
const idleFramesInput = document.getElementById('idleFrames');
const walkFramesInput = document.getElementById('walkFrames');
const jumpFramesInput = document.getElementById('jumpFrames');
const mineFramesInput = document.getElementById('mineFrames');

// Load sprite sheet when selected
spriteSelect.addEventListener('change', (e) => {
    const filename = e.target.value;
    if (filename) {
        editor.isInventorySheet = filename === 'inventory.png';
        editor.isTreesSheet = filename === 'trees.png';
        updateUIForSheetType();
        loadSpriteSheet(filename);
    }
});

// Update UI based on sheet type
function updateUIForSheetType() {
    const animationSection = document.getElementById('animationMappingsSection');
    const objectSection = document.getElementById('objectMappingsSection');
    const characterNameGroup = document.getElementById('characterNameGroup');
    const objectNameGroup = document.getElementById('objectNameGroup');
    const objectNameInput = document.getElementById('objectName');
    const inventoryCategory = document.getElementById('inventoryCategory');
    const shrubsCategory = document.getElementById('shrubsCategory');
    const treesCategory = document.getElementById('treesCategory');
    
    if (editor.isInventorySheet || editor.isTreesSheet) {
        animationSection.style.display = 'none';
        objectSection.style.display = 'block';
        characterNameGroup.style.display = 'none';
        objectNameGroup.style.display = 'block';
        
        // Auto-populate object name based on sheet type
        if (editor.isInventorySheet) {
            objectNameInput.value = 'inventory';
            inventoryCategory.style.display = 'block';
            shrubsCategory.style.display = 'none';
            treesCategory.style.display = 'none';
        } else if (editor.isTreesSheet) {
            objectNameInput.value = 'trees';
            inventoryCategory.style.display = 'none';
            shrubsCategory.style.display = 'block';
            treesCategory.style.display = 'block';
        }
    } else {
        animationSection.style.display = 'block';
        objectSection.style.display = 'none';
        characterNameGroup.style.display = 'block';
        objectNameGroup.style.display = 'none';
        inventoryCategory.style.display = 'none';
        shrubsCategory.style.display = 'none';
        treesCategory.style.display = 'none';
    }
}

// Update parameters
updateParamsBtn.addEventListener('change', updateVisualization);
updateParamsBtn.addEventListener('click', updateVisualization);

// Sync inputs with editor state
frameWidthInput.addEventListener('input', (e) => {
    editor.frameWidth = parseInt(e.target.value) || 32;
});

frameHeightInput.addEventListener('input', (e) => {
    editor.frameHeight = parseInt(e.target.value) || 32;
});

colsInput.addEventListener('input', (e) => {
    editor.cols = parseInt(e.target.value) || 4;
});

rowsInput.addEventListener('input', (e) => {
    editor.rows = parseInt(e.target.value) || 4;
});

displayScaleInput.addEventListener('input', (e) => {
    editor.displayScale = parseInt(e.target.value) || 4;
    updateVisualization();
});

// Load sprite sheet image
function loadSpriteSheet(filename) {
    const img = new Image();
    img.onload = () => {
        editor.currentImage = img;
        
        // Auto-detect dimensions (try to guess frame size)
        const totalFrames = editor.cols * editor.rows;
        const guessedFrameSize = Math.floor(Math.sqrt((img.width * img.height) / totalFrames));
        
        // Update inputs with detected or default values
        editor.frameWidth = guessedFrameSize || 32;
        editor.frameHeight = guessedFrameSize || 32;
        frameWidthInput.value = editor.frameWidth;
        frameHeightInput.value = editor.frameHeight;
        
        // Auto-adjust display scale for large sprite sheets
        // For very large images, use smaller scale to fit better
        if (img.width > 1000 || img.height > 1000) {
            editor.displayScale = Math.max(1, Math.floor(800 / Math.max(img.width, img.height) * 4));
            displayScaleInput.value = editor.displayScale;
        }
        
        // Update image info
        imageInfo.innerHTML = `
            <p><strong>Filename:</strong> ${filename}</p>
            <p><strong>Image Size:</strong> ${img.width} × ${img.height}px</p>
            <p><strong>Suggested Frame Size:</strong> ${guessedFrameSize} × ${guessedFrameSize}px</p>
            <p><strong>Total Frames:</strong> ${totalFrames}</p>
            <p><strong>Display Scale:</strong> ${editor.displayScale}x (adjust if needed)</p>
        `;
        
        updateVisualization();
    };
    img.onerror = () => {
        imageInfo.innerHTML = `<p style="color: red;">Error loading image: ${filename}</p>`;
    };
    img.src = filename;
}

// Update visualization
function updateVisualization() {
    if (!editor.currentImage) return;
    
    drawSpriteSheet();
    drawFramesGrid();
    drawFrameSelector();
}

// Draw sprite sheet with grid overlay
function drawSpriteSheet() {
    const ctx = spriteCanvas.getContext('2d');
    const scale = editor.displayScale;
    
    // Set canvas size
    spriteCanvas.width = editor.currentImage.width * scale;
    spriteCanvas.height = editor.currentImage.height * scale;
    
    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, spriteCanvas.width, spriteCanvas.height);
    
    // Draw image scaled up
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
        editor.currentImage,
        0, 0,
        spriteCanvas.width, spriteCanvas.height
    );
    
    // Draw grid overlay
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.lineWidth = 1;
    
    const frameWidthScaled = editor.frameWidth * scale;
    const frameHeightScaled = editor.frameHeight * scale;
    
    // Vertical lines
    for (let i = 0; i <= editor.cols; i++) {
        const x = i * frameWidthScaled;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, spriteCanvas.height);
        ctx.stroke();
    }
    
    // Horizontal lines
    for (let i = 0; i <= editor.rows; i++) {
        const y = i * frameHeightScaled;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(spriteCanvas.width, y);
        ctx.stroke();
    }
    
    // Draw frame numbers
    ctx.fillStyle = 'rgba(255, 255, 0, 0.8)';
    ctx.font = `${12 * scale}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    for (let row = 0; row < editor.rows; row++) {
        for (let col = 0; col < editor.cols; col++) {
            const frameIndex = row * editor.cols + col;
            const x = (col + 0.5) * frameWidthScaled;
            const y = row * frameHeightScaled + 5;
            ctx.fillText(frameIndex.toString(), x, y);
        }
    }
}

// Draw individual frames grid
function drawFramesGrid() {
    framesGrid.innerHTML = '';
    
    if (!editor.currentImage) return;
    
    const totalFrames = editor.cols * editor.rows;
    const frameScale = 2;
    
    for (let i = 0; i < totalFrames; i++) {
        const frameItem = document.createElement('div');
        frameItem.className = 'frame-item';
        if (editor.selectedFrame === i) {
            frameItem.classList.add('selected');
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = editor.frameWidth * frameScale;
        canvas.height = editor.frameHeight * frameScale;
        
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        
        const col = i % editor.cols;
        const row = Math.floor(i / editor.cols);
        
        const sx = col * editor.frameWidth;
        const sy = row * editor.frameHeight;
        
        ctx.drawImage(
            editor.currentImage,
            sx, sy, editor.frameWidth, editor.frameHeight,
            0, 0, canvas.width, canvas.height
        );
        
        const frameIndex = document.createElement('div');
        frameIndex.className = 'frame-index';
        frameIndex.textContent = `Frame ${i}`;
        
        frameItem.appendChild(canvas);
        frameItem.appendChild(frameIndex);
        
        frameItem.addEventListener('click', () => {
            editor.selectedFrame = i;
            drawFramesGrid();
            drawFrameSelector();
        });
        
        framesGrid.appendChild(frameItem);
    }
}

// Draw frame selector
function drawFrameSelector() {
    frameSelector.innerHTML = '';
    
    if (!editor.currentImage) return;
    
    const totalFrames = editor.cols * editor.rows;
    const frameScale = 1.5;
    
    for (let i = 0; i < totalFrames; i++) {
        const frameItem = document.createElement('div');
        frameItem.className = 'frame-selector-item';
        if (editor.selectedFrame === i) {
            frameItem.style.borderColor = '#28a745';
            frameItem.style.background = '#d4edda';
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = editor.frameWidth * frameScale;
        canvas.height = editor.frameHeight * frameScale;
        
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        
        const col = i % editor.cols;
        const row = Math.floor(i / editor.cols);
        
        const sx = col * editor.frameWidth;
        const sy = row * editor.frameHeight;
        
        ctx.drawImage(
            editor.currentImage,
            sx, sy, editor.frameWidth, editor.frameHeight,
            0, 0, canvas.width, canvas.height
        );
        
        const frameIndex = document.createElement('div');
        frameIndex.className = 'frame-index';
        frameIndex.textContent = i;
        
        frameItem.appendChild(canvas);
        frameItem.appendChild(frameIndex);
        
        frameItem.addEventListener('click', (e) => {
            editor.selectedFrame = i;
            drawFramesGrid();
            drawFrameSelector();
            
            // Show frame info
            console.log(`Selected frame: ${i}`);
            
            if (editor.isInventorySheet || editor.isTreesSheet) {
                // For object sheets, highlight mappable objects
                highlightMappableObjects();
            } else {
                // If an animation input is focused, add this frame to it
                const activeElement = document.activeElement;
                if (activeElement && activeElement.id && activeElement.id.includes('Frames')) {
                    const currentFrames = parseFrames(activeElement.value);
                    if (!currentFrames.includes(i)) {
                        currentFrames.push(i);
                        activeElement.value = currentFrames.join(',');
                        updateAnimationsFromInputs();
                    }
                }
            }
        });
        
        frameSelector.appendChild(frameItem);
    }
}

// Parse frame string (e.g., "0,1,2" or "0")
function parseFrames(frameString) {
    if (!frameString || !frameString.trim()) return [];
    return frameString.split(',').map(f => parseInt(f.trim())).filter(f => !isNaN(f));
}

// Update animations from inputs
function updateAnimationsFromInputs() {
    editor.animations.idle = parseFrames(idleFramesInput.value);
    editor.animations.walk = parseFrames(walkFramesInput.value);
    editor.animations.jump = parseFrames(jumpFramesInput.value);
    editor.animations.mine = parseFrames(mineFramesInput.value);
}

// Sync inputs with animations
function syncAnimationInputs() {
    idleFramesInput.value = editor.animations.idle.join(',');
    walkFramesInput.value = editor.animations.walk.join(',');
    jumpFramesInput.value = editor.animations.jump.join(',');
    mineFramesInput.value = editor.animations.mine.join(',');
}

// Add selected frame to animation
idleFramesInput.addEventListener('focus', () => {
    if (editor.selectedFrame !== null) {
        const frames = parseFrames(idleFramesInput.value);
        if (!frames.includes(editor.selectedFrame)) {
            frames.push(editor.selectedFrame);
            idleFramesInput.value = frames.join(',');
            updateAnimationsFromInputs();
        }
    }
});

walkFramesInput.addEventListener('focus', () => {
    if (editor.selectedFrame !== null) {
        const frames = parseFrames(walkFramesInput.value);
        if (!frames.includes(editor.selectedFrame)) {
            frames.push(editor.selectedFrame);
            walkFramesInput.value = frames.join(',');
            updateAnimationsFromInputs();
        }
    }
});

jumpFramesInput.addEventListener('focus', () => {
    if (editor.selectedFrame !== null) {
        const frames = parseFrames(jumpFramesInput.value);
        if (!frames.includes(editor.selectedFrame)) {
            frames.push(editor.selectedFrame);
            jumpFramesInput.value = frames.join(',');
            updateAnimationsFromInputs();
        }
    }
});

mineFramesInput.addEventListener('focus', () => {
    if (editor.selectedFrame !== null) {
        const frames = parseFrames(mineFramesInput.value);
        if (!frames.includes(editor.selectedFrame)) {
            frames.push(editor.selectedFrame);
            mineFramesInput.value = frames.join(',');
            updateAnimationsFromInputs();
        }
    }
});

// Update animations when inputs change
[idleFramesInput, walkFramesInput, jumpFramesInput, mineFramesInput].forEach(input => {
    input.addEventListener('input', updateAnimationsFromInputs);
});


// Download JSON
downloadJsonBtn.addEventListener('click', () => {
    const jsonString = jsonOutput.value;
    let filename;
    if (editor.isInventorySheet) {
        const objectName = document.getElementById('objectName').value || 'inventory';
        filename = `${objectName}-sprite-config.json`;
    } else if (editor.isTreesSheet) {
        const objectName = document.getElementById('objectName').value || 'trees';
        filename = `${objectName}-sprite-config.json`;
    } else {
        const characterName = characterNameInput.value || 'steve';
        filename = `${characterName}-sprite-config.json`;
    }
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// Close modal
closeModal.addEventListener('click', () => {
    jsonModal.style.display = 'none';
});

closeModalBtn.addEventListener('click', () => {
    jsonModal.style.display = 'none';
});

window.addEventListener('click', (e) => {
    if (e.target === jsonModal) {
        jsonModal.style.display = 'none';
    }
});

// Setup object mapping click handlers
function setupObjectMappings() {
    // Inventory mappings
    const inventoryMappings = {
        'dirtFrame': 'inventory.dirt',
        'stoneFrame': 'inventory.stone',
        'clayFrame': 'inventory.clay',
        'woodFrame': 'inventory.wood',
        'goldFrame': 'inventory.gold',
        'ironFrame': 'inventory.iron',
        'silverFrame': 'inventory.silver'
    };
    
    // Shrub mappings
    const shrubMappings = {
        'shrub1Frame': 'shrubs.shrub1',
        'shrub2Frame': 'shrubs.shrub2',
        'shrub3Frame': 'shrubs.shrub3'
    };
    
    // Tree mappings
    const treeMappings = {
        'treeSmallFrame': 'trees.small',
        'treeMediumFrame': 'trees.medium',
        'treeMedium2Frame': 'trees.medium2',
        'treeLargeFrame': 'trees.large',
        'treeDeadFrame': 'trees.dead',
        'blossom1Frame': 'trees.blossom1',
        'blossom2Frame': 'trees.blossom2',
        'blossom3Frame': 'trees.blossom3',
        'blossom4Frame': 'trees.blossom4',
        'stumpFrame': 'trees.stump'
    };
    
    // Setup click handlers for all mapping inputs
    const allMappings = {...inventoryMappings, ...shrubMappings, ...treeMappings};
    
    Object.keys(allMappings).forEach(inputId => {
        const input = document.getElementById(inputId);
        const label = input.previousElementSibling;
        const mappingPath = allMappings[inputId];
        
        if (label && input) {
            // Make label clickable
            label.style.cursor = 'pointer';
            label.style.userSelect = 'none';
            label.title = 'Click to map selected frame';
            
            label.addEventListener('click', () => {
                if (editor.selectedFrame !== null) {
                    // Update the mapping
                    const [category, item] = mappingPath.split('.');
                    editor.objectMappings[category][item] = editor.selectedFrame;
                    
                    // Update the input
                    input.value = editor.selectedFrame;
                    
                    // Visual feedback
                    label.style.background = '#d4edda';
                    setTimeout(() => {
                        label.style.background = '';
                    }, 500);
                    
                    console.log(`Mapped ${mappingPath} to frame ${editor.selectedFrame}`);
                } else {
                    alert('Please select a frame first by clicking on it in the frame selector below.');
                }
            });
        }
    });
}

// Highlight objects that can be mapped
function highlightMappableObjects() {
    // Remove previous highlights
    document.querySelectorAll('.mapping-group label').forEach(label => {
        label.style.background = '';
    });
    
    // Highlight only visible mappable labels
    const visibleCategory = editor.isInventorySheet ? '#inventoryCategory' : 
                           (editor.isTreesSheet ? '#shrubsCategory, #treesCategory' : '');
    
    if (visibleCategory) {
        document.querySelectorAll(`${visibleCategory} .mapping-group label`).forEach(label => {
            label.style.cursor = 'pointer';
            label.style.border = '1px solid transparent';
            label.style.padding = '2px 4px';
            label.style.borderRadius = '3px';
        });
    }
}

// Sync object mappings to inputs
function syncObjectMappings() {
    // Inventory
    document.getElementById('dirtFrame').value = editor.objectMappings.inventory.dirt !== null ? editor.objectMappings.inventory.dirt : '';
    document.getElementById('stoneFrame').value = editor.objectMappings.inventory.stone !== null ? editor.objectMappings.inventory.stone : '';
    document.getElementById('clayFrame').value = editor.objectMappings.inventory.clay !== null ? editor.objectMappings.inventory.clay : '';
    document.getElementById('woodFrame').value = editor.objectMappings.inventory.wood !== null ? editor.objectMappings.inventory.wood : '';
    document.getElementById('goldFrame').value = editor.objectMappings.inventory.gold !== null ? editor.objectMappings.inventory.gold : '';
    document.getElementById('ironFrame').value = editor.objectMappings.inventory.iron !== null ? editor.objectMappings.inventory.iron : '';
    document.getElementById('silverFrame').value = editor.objectMappings.inventory.silver !== null ? editor.objectMappings.inventory.silver : '';
    
    // Shrubs
    document.getElementById('shrub1Frame').value = editor.objectMappings.shrubs.shrub1 !== null ? editor.objectMappings.shrubs.shrub1 : '';
    document.getElementById('shrub2Frame').value = editor.objectMappings.shrubs.shrub2 !== null ? editor.objectMappings.shrubs.shrub2 : '';
    document.getElementById('shrub3Frame').value = editor.objectMappings.shrubs.shrub3 !== null ? editor.objectMappings.shrubs.shrub3 : '';
    
    // Trees
    document.getElementById('treeSmallFrame').value = editor.objectMappings.trees.small !== null ? editor.objectMappings.trees.small : '';
    document.getElementById('treeMediumFrame').value = editor.objectMappings.trees.medium !== null ? editor.objectMappings.trees.medium : '';
    document.getElementById('treeMedium2Frame').value = editor.objectMappings.trees.medium2 !== null ? editor.objectMappings.trees.medium2 : '';
    document.getElementById('treeLargeFrame').value = editor.objectMappings.trees.large !== null ? editor.objectMappings.trees.large : '';
    document.getElementById('treeDeadFrame').value = editor.objectMappings.trees.dead !== null ? editor.objectMappings.trees.dead : '';
    document.getElementById('blossom1Frame').value = editor.objectMappings.trees.blossom1 !== null ? editor.objectMappings.trees.blossom1 : '';
    document.getElementById('blossom2Frame').value = editor.objectMappings.trees.blossom2 !== null ? editor.objectMappings.trees.blossom2 : '';
    document.getElementById('blossom3Frame').value = editor.objectMappings.trees.blossom3 !== null ? editor.objectMappings.trees.blossom3 : '';
    document.getElementById('blossom4Frame').value = editor.objectMappings.trees.blossom4 !== null ? editor.objectMappings.trees.blossom4 : '';
    document.getElementById('stumpFrame').value = editor.objectMappings.trees.stump !== null ? editor.objectMappings.trees.stump : '';
}

// Export JSON
exportJsonBtn.addEventListener('click', () => {
    if (editor.isInventorySheet) {
        // Export inventory mappings only
        // Ensure objectName matches the sheet type
        const objectNameInput = document.getElementById('objectName');
        const objectName = objectNameInput.value.trim() || 'inventory';
        objectNameInput.value = objectName; // Update field to ensure consistency
        
        const config = {
            objectName: objectName,
            spriteSheet: spriteSelect.value || '',
            frameWidth: editor.frameWidth,
            frameHeight: editor.frameHeight,
            cols: editor.cols,
            rows: editor.rows,
            objectMappings: {
                inventory: editor.objectMappings.inventory
            }
        };
        
        const jsonString = JSON.stringify(config, null, 2);
        jsonOutput.value = jsonString;
        jsonModal.style.display = 'block';
    } else if (editor.isTreesSheet) {
        // Export trees and shrubs mappings only
        // Ensure objectName matches the sheet type
        const objectNameInput = document.getElementById('objectName');
        const objectName = objectNameInput.value.trim() || 'trees';
        objectNameInput.value = objectName; // Update field to ensure consistency
        
        const config = {
            objectName: objectName,
            spriteSheet: spriteSelect.value || '',
            frameWidth: editor.frameWidth,
            frameHeight: editor.frameHeight,
            cols: editor.cols,
            rows: editor.rows,
            objectMappings: {
                shrubs: editor.objectMappings.shrubs,
                trees: editor.objectMappings.trees
            }
        };
        
        const jsonString = JSON.stringify(config, null, 2);
        jsonOutput.value = jsonString;
        jsonModal.style.display = 'block';
    } else {
        // Export character animations
        updateAnimationsFromInputs();
        
        const config = {
            characterName: characterNameInput.value || 'steve',
            spriteSheet: spriteSelect.value || '',
            frameWidth: editor.frameWidth,
            frameHeight: editor.frameHeight,
            cols: editor.cols,
            rows: editor.rows,
            animations: editor.animations
        };
        
        const jsonString = JSON.stringify(config, null, 2);
        jsonOutput.value = jsonString;
        jsonModal.style.display = 'block';
    }
});

// Copy to clipboard
copyJsonBtn.addEventListener('click', () => {
    if (editor.isInventorySheet) {
        // Ensure objectName matches the sheet type
        const objectNameInput = document.getElementById('objectName');
        const objectName = objectNameInput.value.trim() || 'inventory';
        objectNameInput.value = objectName; // Update field to ensure consistency
        
        const config = {
            objectName: objectName,
            spriteSheet: spriteSelect.value || '',
            frameWidth: editor.frameWidth,
            frameHeight: editor.frameHeight,
            cols: editor.cols,
            rows: editor.rows,
            objectMappings: {
                inventory: editor.objectMappings.inventory
            }
        };
        
        const jsonString = JSON.stringify(config, null, 2);
        
        navigator.clipboard.writeText(jsonString).then(() => {
            copyJsonBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyJsonBtn.textContent = 'Copy to Clipboard';
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
            alert('Failed to copy to clipboard');
        });
    } else if (editor.isTreesSheet) {
        // Ensure objectName matches the sheet type
        const objectNameInput = document.getElementById('objectName');
        const objectName = objectNameInput.value.trim() || 'trees';
        objectNameInput.value = objectName; // Update field to ensure consistency
        
        const config = {
            objectName: objectName,
            spriteSheet: spriteSelect.value || '',
            frameWidth: editor.frameWidth,
            frameHeight: editor.frameHeight,
            cols: editor.cols,
            rows: editor.rows,
            objectMappings: {
                shrubs: editor.objectMappings.shrubs,
                trees: editor.objectMappings.trees
            }
        };
        
        const jsonString = JSON.stringify(config, null, 2);
        
        navigator.clipboard.writeText(jsonString).then(() => {
            copyJsonBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyJsonBtn.textContent = 'Copy to Clipboard';
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
            alert('Failed to copy to clipboard');
        });
    } else {
        updateAnimationsFromInputs();
        
        const config = {
            characterName: characterNameInput.value || 'steve',
            spriteSheet: spriteSelect.value || '',
            frameWidth: editor.frameWidth,
            frameHeight: editor.frameHeight,
            cols: editor.cols,
            rows: editor.rows,
            animations: editor.animations
        };
        
        const jsonString = JSON.stringify(config, null, 2);
        
        navigator.clipboard.writeText(jsonString).then(() => {
            copyJsonBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyJsonBtn.textContent = 'Copy to Clipboard';
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
            alert('Failed to copy to clipboard');
        });
    }
});

// Initialize
syncAnimationInputs();
setupObjectMappings();
syncObjectMappings();

