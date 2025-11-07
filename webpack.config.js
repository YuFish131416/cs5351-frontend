const path = require('path');

/**
 * Webpack configuration for bundling the VS Code extension.
 * Entry is the extension activation file and output is a commonjs2 bundle for VS Code.
 */
module.exports = {
	target: 'node',
	mode: 'production',
	entry: './src/extension/extension.ts',
	output: {
		path: path.resolve(__dirname, 'dist'),
		filename: 'extension.js',
		libraryTarget: 'commonjs2'
	},
	devtool: 'source-map',
	externals: {
		// the vscode-module is created on-the-fly and must be excluded.
		vscode: 'commonjs vscode'
	},
	resolve: {
		extensions: ['.ts', '.js']
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: [
					{
						loader: 'ts-loader'
					}
				]
			}
		]
	}
};
