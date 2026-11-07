import { defineConfig, pvtnbr } from 'lintroll';

export default defineConfig([
	...pvtnbr({
		node: true,
	}),
	{
		files: ['src/**/*.ts'],
		rules: {
			'import-x/no-restricted-paths': ['error', {
				zones: [{
					target: './src/utils',
					from: './src',
					except: ['./utils'],
					message: 'utils/ modules are generic primitives: import only built-ins, packages, and other utils/ modules.',
				}],
			}],
		},
	},
]);
