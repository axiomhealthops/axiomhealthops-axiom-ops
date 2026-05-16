import "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import.meta.url;
var vite_config_default = defineConfig({
	plugins: [react()],
	resolve: { alias: { "@": "/src" } }
});
//#endregion
export { vite_config_default as default };

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidml0ZS5jb25maWcuanMiLCJuYW1lcyI6W10sInNvdXJjZXMiOlsiL3Nlc3Npb25zL3NoYXJwLXBlYWNlZnVsLXBhc2NhbC9tbnQvZWRlbWFjYXJlLW9wcy92aXRlLmNvbmZpZy5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6ICcvc3JjJyxcbiAgICB9LFxuICB9LFxufSk7XG4iXSwibWFwcGluZ3MiOiI7Ozs7QUFHQSxJQUFBLHNCQUFlLGFBQWE7Q0FDMUIsU0FBUyxDQUFDLE1BQU0sQ0FBQztDQUNqQixTQUFTLEVBQ1AsT0FBTyxFQUNMLEtBQUssT0FDUCxFQUNGO0FBQ0YsQ0FBQyJ9