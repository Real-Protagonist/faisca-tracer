// Sem janela de consola no Windows em modo de produção.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    faisca_lib::run()
}
