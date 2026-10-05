import Phaser from 'phaser';

// ── Параметры игры ─────────────────────────────────────────────
const GRID_ROWS = 10;
const GRID_COLS = 10;
const CELL_SIZE = 44;
const CELL_GAP = 4;
const PITCH = CELL_SIZE + CELL_GAP;
const GRID_X = 36;
const GRID_Y = 96;
const PANEL_X = 560;

/** Слова, которые нужно найти (всегда помещаются в поле). */
const WORDS = ['КОТ', 'ДОМ', 'ЛЕС', 'МОРЕ', 'РЕКА', 'ГОРА', 'СНЕГ', 'ЗИМА', 'ВЕСНА', 'ОСЕНЬ'] as const;
/** Буквы для заполнения пустых клеток (частотные буквы русского алфавита). */
const FILLER_LETTERS = 'ОЕАИНТСРВЛКМДПУЯЬГЗБЧЙХЖШЮЦЩЭФЪ';

const DIRECTIONS: ReadonlyArray<{ dr: number; dc: number }> = [
  { dr: -1, dc: 0 },
  { dr: -1, dc: 1 },
  { dr: 0, dc: 1 },
  { dr: 1, dc: 1 },
  { dr: 1, dc: 0 },
  { dr: 1, dc: -1 },
  { dr: 0, dc: -1 },
  { dr: -1, dc: -1 },
];

/** Сколько секунд экран остаётся зелёным после найденного слова. */
const FLASH_DURATION_MS = 2000;

// ── Цвета ──────────────────────────────────────────────────────
const COLOR_CELL = 0x1e293b;
const COLOR_CELL_SELECTED = 0x38bdf8;
const COLOR_CELL_FOUND = 0x166534;
const COLOR_LETTER = 0xf1f5f9;
const COLOR_LETTER_SELECTED = 0x0f172a;
const COLOR_LETTER_FOUND = 0xbbf7d0;
const COLOR_STRIKE = 0xf87171;
const COLOR_FLASH = 0x22c55e;
const COLOR_MUTED = 0x94a3b8;
const COLOR_ACCENT = 0x38bdf8;

// ── Вспомогательные функции ────────────────────────────────────
function randInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function pick<T>(values: readonly T[]): T {
  return values[randInt(values.length)];
}

function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

interface CellCoord {
  row: number;
  col: number;
}

interface PlacedWord {
  word: string;
  cells: CellCoord[];
  found: boolean;
}

interface CellView {
  bg: Phaser.GameObjects.Rectangle;
  letter: Phaser.GameObjects.Text;
  strike: Phaser.GameObjects.Rectangle;
}

type CellState = 'base' | 'selected' | 'found';

/**
 * Филворд: на поле из букв спрятаны слова.
 * Игрок проводит мышью/пальцем по буквам, собирая цепочку. Если получилось слово
 * из списка — буквы зачёркиваются, экран вспыхивает зелёным, игра продолжается,
 * пока не будут найдены все слова.
 */
export class GameScene extends Phaser.Scene {
  private letters: string[][] = [];
  private placedWords: PlacedWord[] = [];
  private cells: CellView[][] = [];
  private wordTexts: Phaser.GameObjects.Text[] = [];

  private selection: CellCoord[] = [];
  private highlighted: CellCoord[] = [];
  private selecting = false;
  private flashActive = false;
  private gameOver = false;

  private statusText!: Phaser.GameObjects.Text;
  private pathGraphics!: Phaser.GameObjects.Graphics;
  private greenOverlay!: Phaser.GameObjects.Rectangle;

  constructor() {
    super('GameScene');
  }

  create(): void {
    // Сброс состояния на случай перезапуска сцены (кнопка «Играть снова»).
    this.selection = [];
    this.highlighted = [];
    this.selecting = false;
    this.flashActive = false;
    this.gameOver = false;
    this.letters = [];
    this.placedWords = [];
    this.cells = [];
    this.wordTexts = [];

    const { width, height } = this.scale;

    this.add
      .text(GRID_X, 24, 'ФИЛВОРД', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '34px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0, 0);

    this.add
      .text(GRID_X, 66, 'Проведи по буквам и собери все слова. ESC — сбросить выделение.', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '16px',
        color: toCss(COLOR_MUTED),
      })
      .setOrigin(0, 0);

    this.statusText = this.add
      .text(PANEL_X, 24, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '22px',
        color: '#ffffff',
      })
      .setOrigin(0, 0);

    this.add
      .text(PANEL_X, 62, 'Найди слова:', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: toCss(COLOR_MUTED),
      })
      .setOrigin(0, 0);

    const board = this.generateBoard();
    this.letters = board.grid;
    this.placedWords = board.placed;

    this.buildCells();
    this.buildWordPanel();
    this.updateStatus();

    // Линия выбранной цепочки рисуется поверх клеток.
    this.pathGraphics = this.add.graphics();

    // Зелёная вспышка поверх всего экрана.
    this.greenOverlay = this.add
      .rectangle(width / 2, height / 2, width, height, COLOR_FLASH, 0)
      .setDepth(100);

    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handlePointerUp, this);
    this.input.on('pointerupoutside', this.handlePointerUp, this);

    if (this.input.keyboard) {
      this.input.keyboard.on('keydown-ESC', () => this.clearSelection());
    }
  }

  // ── Генерация поля ────────────────────────────────────────────

  private generateBoard(): { grid: string[][]; placed: PlacedWord[] } {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const grid: string[][] = Array.from({ length: GRID_ROWS }, () =>
        Array<string>(GRID_COLS).fill(''),
      );
      const placed: PlacedWord[] = [];
      const shuffled = [...WORDS].sort(() => Math.random() - 0.5);
      let allPlaced = true;

      for (const word of shuffled) {
        const cells = this.tryPlaceWord(word, grid);
        if (!cells) {
          allPlaced = false;
          break;
        }
        placed.push({ word, cells, found: false });
      }

      if (!allPlaced) continue;

      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          if (grid[row][col] === '') {
            grid[row][col] = FILLER_LETTERS[randInt(FILLER_LETTERS.length)];
          }
        }
      }
      return { grid, placed };
    }
    throw new Error('Не удалось сгенерировать поле.');
  }

  /** Пытается разместить слово прямыми линиями (8 направлений), не пересекая другие слова. */
  private tryPlaceWord(word: string, grid: string[][]): CellCoord[] | null {
    for (let attempt = 0; attempt < 300; attempt++) {
      const dir = pick(DIRECTIONS);
      const startRow = randInt(GRID_ROWS);
      const startCol = randInt(GRID_COLS);
      const endRow = startRow + (word.length - 1) * dir.dr;
      const endCol = startCol + (word.length - 1) * dir.dc;

      if (endRow < 0 || endRow >= GRID_ROWS || endCol < 0 || endCol >= GRID_COLS) continue;

      const cells: CellCoord[] = [];
      let fits = true;
      for (let i = 0; i < word.length; i++) {
        const row = startRow + i * dir.dr;
        const col = startCol + i * dir.dc;
        if (grid[row][col] !== '') {
          fits = false;
          break;
        }
        cells.push({ row, col });
      }
      if (!fits) continue;

      for (let i = 0; i < word.length; i++) {
        grid[cells[i].row][cells[i].col] = word[i];
      }
      return cells;
    }
    return null;
  }

  // ── Отрисовка ─────────────────────────────────────────────────

  private buildCells(): void {
    for (let row = 0; row < GRID_ROWS; row++) {
      this.cells[row] = [];
      for (let col = 0; col < GRID_COLS; col++) {
        const x = GRID_X + col * PITCH + CELL_SIZE / 2;
        const y = GRID_Y + row * PITCH + CELL_SIZE / 2;

        const bg = this.add.rectangle(x, y, CELL_SIZE, CELL_SIZE, COLOR_CELL);
        const letter = this.add
          .text(x, y, this.letters[row][col], {
            fontFamily: 'system-ui, sans-serif',
            fontSize: '26px',
            color: toCss(COLOR_LETTER),
          })
          .setOrigin(0.5);
        const strike = this.add
          .rectangle(x, y, CELL_SIZE - 8, 3, COLOR_STRIKE)
          .setAlpha(0);

        this.cells[row][col] = { bg, letter, strike };
      }
    }
  }

  private buildWordPanel(): void {
    this.wordTexts = this.placedWords.map((pw, index) =>
      this.add
        .text(PANEL_X, 104 + index * 34, pw.word, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '22px',
          color: toCss(COLOR_LETTER),
        })
        .setOrigin(0, 0),
    );
  }

  private setCellState(row: number, col: number, state: CellState): void {
    const view = this.cells[row][col];
    switch (state) {
      case 'selected':
        view.bg.setFillStyle(COLOR_CELL_SELECTED);
        view.letter.setColor(toCss(COLOR_LETTER_SELECTED));
        view.strike.setAlpha(0);
        break;
      case 'found':
        view.bg.setFillStyle(COLOR_CELL_FOUND);
        view.letter.setColor(toCss(COLOR_LETTER_FOUND));
        view.strike.setAlpha(1);
        break;
      default:
        view.bg.setFillStyle(COLOR_CELL);
        view.letter.setColor(toCss(COLOR_LETTER));
        view.strike.setAlpha(0);
    }
  }

  // ── Выделение цепочки ─────────────────────────────────────────

  private cellAt(worldX: number, worldY: number): CellCoord | null {
    const col = Math.floor((worldX - GRID_X) / PITCH);
    const row = Math.floor((worldY - GRID_Y) / PITCH);
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) return null;
    return { row, col };
  }

  private isAdjacent(a: CellCoord, b: CellCoord): boolean {
    return Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1;
  }

  private isSelectedCell(cell: CellCoord): boolean {
    return this.selection.some((c) => c.row === cell.row && c.col === cell.col);
  }

  private isFoundCell(cell: CellCoord): boolean {
    return this.placedWords.some(
      (pw) => pw.found && pw.cells.some((c) => c.row === cell.row && c.col === cell.col),
    );
  }

  private refreshSelectionVisuals(): void {
    for (const c of this.highlighted) {
      this.setCellState(c.row, c.col, 'base');
    }
    this.highlighted = [...this.selection];
    for (const c of this.selection) {
      this.setCellState(c.row, c.col, 'selected');
    }

    this.pathGraphics.clear();
    if (this.selection.length >= 2) {
      this.pathGraphics.lineStyle(4, COLOR_ACCENT, 0.7);
      this.pathGraphics.beginPath();
      this.selection.forEach((c, index) => {
        const x = GRID_X + c.col * PITCH + CELL_SIZE / 2;
        const y = GRID_Y + c.row * PITCH + CELL_SIZE / 2;
        if (index === 0) this.pathGraphics.moveTo(x, y);
        else this.pathGraphics.lineTo(x, y);
      });
      this.pathGraphics.strokePath();
    }
  }

  private clearSelection(): void {
    this.selecting = false;
    this.selection = [];
    this.refreshSelectionVisuals();
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.flashActive || this.gameOver) return;
    const cell = this.cellAt(pointer.worldX, pointer.worldY);
    if (!cell || this.isFoundCell(cell)) return;
    this.selecting = true;
    this.selection = [cell];
    this.refreshSelectionVisuals();
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.selecting || !pointer.isDown || this.flashActive || this.gameOver) return;
    const cell = this.cellAt(pointer.worldX, pointer.worldY);
    if (!cell) return;

    const last = this.selection[this.selection.length - 1];
    if (last.row === cell.row && last.col === cell.col) return;

    // Возврат по уже пройденной цепочке — убираем последнюю клетку.
    if (this.selection.length >= 2) {
      const prev = this.selection[this.selection.length - 2];
      if (prev.row === cell.row && prev.col === cell.col) {
        this.selection.pop();
        this.refreshSelectionVisuals();
        return;
      }
    }

    if (!this.isAdjacent(last, cell)) return;
    if (this.isSelectedCell(cell) || this.isFoundCell(cell)) return;

    this.selection.push(cell);
    this.refreshSelectionVisuals();
  }

  private handlePointerUp(): void {
    if (!this.selecting) return;
    this.selecting = false;
    this.validateSelection();
  }

  // ── Проверка и результат ──────────────────────────────────────

  private validateSelection(): void {
    if (this.selection.length < 2) {
      this.clearSelection();
      return;
    }

    const drawn = this.selection.map((c) => this.letters[c.row][c.col]).join('');
    const reversed = [...drawn].reverse().join('');
    const match = this.placedWords.find(
      (pw) => !pw.found && (pw.word === drawn || pw.word === reversed),
    );

    if (!match) {
      this.clearSelection();
      return;
    }

    match.found = true;
    for (const c of match.cells) {
      this.setCellState(c.row, c.col, 'found');
    }
    this.updateWordPanel();
    this.updateStatus();
    this.clearSelection();
    this.flashGreen();

    if (this.placedWords.every((pw) => pw.found)) {
      this.showWin();
    }
  }

  private updateWordPanel(): void {
    this.placedWords.forEach((pw, index) => {
      if (pw.found) {
        this.wordTexts[index].setText(`✓ ${pw.word}`);
        this.wordTexts[index].setColor(toCss(COLOR_LETTER_FOUND));
      }
    });
  }

  private updateStatus(): void {
    const foundCount = this.placedWords.filter((pw) => pw.found).length;
    const total = this.placedWords.length;
    this.statusText.setText(`Найдено: ${foundCount} из ${total}`);
    this.statusText.setColor(foundCount === total ? toCss(COLOR_LETTER_FOUND) : '#ffffff');
  }

  private flashGreen(): void {
    this.flashActive = true;
    this.greenOverlay.setAlpha(0.35);
    this.tweens.add({
      targets: this.greenOverlay,
      alpha: 0,
      duration: 500,
      delay: FLASH_DURATION_MS - 500,
      onComplete: () => {
        this.flashActive = false;
      },
    });
  }

  private showWin(): void {
    this.gameOver = true;
    this.clearSelection();

    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2 - 10;

    this.add
      .rectangle(cx, cy, width, height, 0x000000, 0.6)
      .setDepth(150)
      .setInteractive();

    this.add.rectangle(cx, cy, 440, 230, 0x1e293b, 0.95).setDepth(151);

    this.add
      .text(cx, cy - 60, 'Победа!', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '42px',
        fontStyle: 'bold',
        color: toCss(COLOR_LETTER_FOUND),
      })
      .setOrigin(0.5)
      .setDepth(152);

    this.add
      .text(cx, cy - 8, `Все слова найдены: ${this.placedWords.length} из ${this.placedWords.length}`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: toCss(COLOR_MUTED),
      })
      .setOrigin(0.5)
      .setDepth(152);

    const button = this.add
      .rectangle(cx, cy + 55, 230, 56, COLOR_ACCENT, 1)
      .setDepth(153)
      .setInteractive({ useHandCursor: true });

    this.add
      .text(cx, cy + 55, 'Играть снова', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#0f172a',
      })
      .setOrigin(0.5)
      .setDepth(154);

    button.on('pointerdown', () => this.scene.restart());
  }
}
