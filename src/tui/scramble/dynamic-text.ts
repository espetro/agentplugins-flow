import type { Component } from '@earendil-works/pi-tui';
import { Text, truncateToWidth } from '@earendil-works/pi-tui';

export class DynamicScrambleText implements Component {
	private base: Text;
	constructor(
		initialContent: string,
		private getScrambleContent: () => string,
		private truncated: boolean = false,
	) {
		this.base = new Text(initialContent, 0, 0);
	}
	invalidate(): void { this.base.invalidate(); }
	render(width: number): string[] {
		const content = this.getScrambleContent();
		const safeContent = content.replace(/[\r\n\t]+/g, ' ');
		this.base.setText(this.truncated ? truncateToWidth(safeContent, width) : safeContent);
		return this.base.render(width);
	}
}
