/// Aplicação de desktop: a interface (React) e o simulador (Web Worker) correm na WebView.
/// O lado nativo só dá diálogos de ficheiros e acesso ao disco.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("erro ao arrancar o Faísca Tracer");
}
