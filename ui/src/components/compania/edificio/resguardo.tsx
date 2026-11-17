// PLA-I47-7: a part of /ceo that fails to draw (one unexpected field in a read) says so in its place, with
// Reintentar, instead of taking the whole page down. Used by the page around the building and around La ficha
// (Building stays hook-free and class-free for the tests that expand it).
import { Component, type ErrorInfo, type ReactNode } from "react";

export class Resguardo extends Component<{ what: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`No se pudo dibujar ${this.props.what}`, error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="edi-fail" role="alert" data-resguardo={this.props.what}>
        <p>No se pudo dibujar {this.props.what}. Puede que un dato haya llegado incompleto.</p>
        <button type="button" className="edi-btn" onClick={() => this.setState({ failed: false })} data-control="resguardo-reintentar">
          Reintentar
        </button>
      </div>
    );
  }
}
