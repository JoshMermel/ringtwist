export const DEFAULT_SCRAMBLE_MOVES = 100;

export function rollRandomSeed(): string {
  return String(Math.floor(10000 + Math.random() * 90000));
}

export interface ScramblePopoverCallbacks {
  onApply: (seed: string, moves: number) => void;
  onClear: () => void;
}

export class ScramblePopoverController {
  private toggleBtn: HTMLButtonElement;
  private popoverEl: HTMLElement;
  private seedInput: HTMLInputElement;
  private movesInput: HTMLInputElement;
  private clearBtn: HTMLButtonElement;
  private currentSeed: string | null = null;
  private currentMoves = DEFAULT_SCRAMBLE_MOVES;

  constructor(root: HTMLElement, callbacks: ScramblePopoverCallbacks) {
    this.toggleBtn = root.querySelector('#btn-scramble-toggle')!;
    this.popoverEl = root.querySelector('#scramble-popover')!;
    this.seedInput = root.querySelector('#sp-seed')!;
    this.movesInput = root.querySelector('#sp-moves')!;
    this.clearBtn = root.querySelector('#btn-sp-clear')!;

    this.toggleBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (this.popoverEl.hidden) {
        this.syncFields();
        this.popoverEl.hidden = false;
        this.seedInput.focus();
        this.seedInput.select();
      } else {
        this.close();
      }
    });

    document.addEventListener('click', (ev) => {
      if (!this.popoverEl.hidden && !(ev.target as HTMLElement).closest('.scramble-wrap')) {
        this.close();
      }
    });

    // Only rolls a new seed into the textbox — never mutates puzzle state until Apply is clicked.
    root.querySelector('#btn-sp-rand')!.addEventListener('click', () => {
      this.seedInput.value = rollRandomSeed();
      this.seedInput.focus();
      this.seedInput.select();
    });

    root.querySelector<HTMLFormElement>('#scramble-form')!.addEventListener('submit', (ev) => {
      ev.preventDefault();
      callbacks.onApply(
        this.seedInput.value || rollRandomSeed(),
        parseInt(this.movesInput.value, 10) || DEFAULT_SCRAMBLE_MOVES,
      );
    });

    this.clearBtn.addEventListener('click', () => callbacks.onClear());
  }

  public sync(seed: string | null, moves: number): void {
    this.currentSeed = seed;
    this.currentMoves = moves;
    this.syncFields();
  }

  public isOpen(): boolean {
    return !this.popoverEl.hidden;
  }

  public close(): void {
    this.popoverEl.hidden = true;
  }

  private syncFields(): void {
    this.seedInput.value = this.currentSeed ?? rollRandomSeed();
    this.movesInput.value = String(this.currentMoves);
    this.clearBtn.hidden = this.currentSeed === null;
    this.toggleBtn.classList.toggle('active', this.currentSeed !== null);
  }
}
