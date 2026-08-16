import argparse

from .launcher import run


def main() -> None:
    parser = argparse.ArgumentParser(description="Launch the local Music Importer application")
    parser.add_argument("--debug", action="store_true", help="enable diagnostic logging")
    args = parser.parse_args()
    run(debug=args.debug)


if __name__ == "__main__":
    main()
