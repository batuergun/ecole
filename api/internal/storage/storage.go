package storage

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

type Storage struct {
	basePath string
}

func New(basePath string) (*Storage, error) {
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage directory: %w", err)
	}
	return &Storage{basePath: basePath}, nil
}

func (s *Storage) Save(key string, r io.Reader) error {
	fullPath := filepath.Join(s.basePath, key)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		return err
	}
	f, err := os.Create(fullPath)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, r)
	return err
}

func (s *Storage) Open(key string) (io.ReadCloser, error) {
	return os.Open(filepath.Join(s.basePath, key))
}

func (s *Storage) Delete(key string) error {
	return os.Remove(filepath.Join(s.basePath, key))
}

func (s *Storage) Path(key string) string {
	return filepath.Join(s.basePath, key)
}
